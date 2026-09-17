const crypto = require("crypto");
const cookie = require("cookie");
const { apiVersion, MetaApiError, redact } = require("./graph");

// Facebook Login for Business — the server side of "Connect Facebook".
//
//   GET /api/auth/meta            → buildAuthorizeUrl() + a signed state
//                                   cookie, redirect to facebook.com
//   GET /api/auth/meta/callback   → verifyState(), exchangeCode() (server
//                                   side, needs META_APP_SECRET), then
//                                   fetchManagedPages() with the user token
//
// The state value is an HMAC-signed, expiring blob that also carries which
// company the admin was connecting (the super admin can act on any). It is
// echoed by Facebook in the callback query string and must match the copy
// in the admin's cookie — a link a third party crafted can't complete the
// flow, and the callback can't be replayed for a different company.
//
// Permissions requested are exactly the four the Lead Ads integration uses.
// If the app has a Facebook Login for Business *configuration*
// (META_LOGIN_CONFIG_ID), that is sent instead of a scope list and Meta
// applies the configuration's permissions.

const STATE_COOKIE = "meta_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const SCOPES = ["pages_show_list", "pages_manage_metadata", "leads_retrieval", "pages_read_engagement"];

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

// state = base64url(json).signature
function createState({ companyId, returnTo }) {
  const body = Buffer.from(
    JSON.stringify({ n: crypto.randomBytes(16).toString("hex"), c: String(companyId), r: returnTo || "/meta-integration", e: Date.now() + STATE_TTL_MS })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [body, sig] = state.split(".");
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data?.e || Date.now() > data.e) return null;
  return { companyId: data.c, returnTo: data.r, nonce: data.n };
}

function stateCookie(value, maxAgeSeconds = STATE_TTL_MS / 1000) {
  return cookie.serialize(STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from facebook.com
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/meta",
    maxAge: maxAgeSeconds,
  });
}

function readStateCookie(req) {
  return cookie.parse(req.headers.cookie || "")[STATE_COOKIE] || "";
}

// The redirect URI must be whitelisted in the Meta app (Facebook Login →
// Settings → Valid OAuth Redirect URIs) and match here byte for byte, so it
// is derived from one place: META_OAUTH_REDIRECT_URI, else the deployed
// origin of META_WEBHOOK_URL, else the request host.
function redirectUri(req) {
  if (process.env.META_OAUTH_REDIRECT_URI) return process.env.META_OAUTH_REDIRECT_URI;
  if (process.env.META_WEBHOOK_URL) {
    try {
      return `${new URL(process.env.META_WEBHOOK_URL).origin}/api/auth/meta/callback`;
    } catch {
      /* fall through */
    }
  }
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/meta/callback`;
}

function buildAuthorizeUrl({ state, redirect }) {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error("META_APP_ID is not set");
  const url = new URL(`https://www.facebook.com/${apiVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (process.env.META_LOGIN_CONFIG_ID) {
    url.searchParams.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  } else {
    url.searchParams.set("scope", SCOPES.join(","));
  }
  return url.toString();
}

async function graphGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${apiVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new MetaApiError(`Meta request failed: ${redact(err.message)}`, { status: 0, code: 4 });
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new MetaApiError(redact(e.message || `HTTP ${res.status}`), { code: e.code, subcode: e.error_subcode, type: e.type, status: res.status });
  }
  return body;
}

// code → short-lived user token → long-lived user token (~60 days). Page
// tokens taken from a long-lived user token do not expire.
async function exchangeCode(code, redirect) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET are not set");
  const short = await graphGet("oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirect, code });
  try {
    const long = await graphGet("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    });
    return long.access_token || short.access_token;
  } catch (err) {
    console.warn("[meta-oauth] long-lived exchange failed, continuing with short-lived token:", redact(err.message));
    return short.access_token;
  }
}

async function fetchProfile(userToken) {
  return graphGet("me", { fields: "id,name", access_token: userToken });
}

async function fetchGrantedScopes(userToken) {
  try {
    const body = await graphGet("me/permissions", { access_token: userToken });
    return (body.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
  } catch {
    return [];
  }
}

// Every Page the user can manage, each with its own Page token.
async function fetchManagedPages(userToken) {
  const pages = [];
  let after = "";
  for (let i = 0; i < 20; i++) {
    const body = await graphGet("me/accounts", {
      fields: "id,name,access_token,tasks,instagram_business_account{id,username}",
      limit: 100,
      after,
      access_token: userToken,
    });
    for (const p of body.data || []) {
      pages.push({
        pageId: String(p.id),
        pageName: p.name || "",
        accessToken: p.access_token || "",
        tasks: p.tasks || [],
        instagramAccountId: p.instagram_business_account?.id || "",
        instagramUsername: p.instagram_business_account?.username || "",
      });
    }
    after = body.paging?.cursors?.after || "";
    if (!after || !body.paging?.next) break;
  }
  return pages;
}

module.exports = {
  SCOPES,
  STATE_COOKIE,
  createState,
  verifyState,
  stateCookie,
  readStateCookie,
  redirectUri,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  fetchGrantedScopes,
  fetchManagedPages,
};
