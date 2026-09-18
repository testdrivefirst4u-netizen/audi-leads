// Thin, server-only client for the handful of Meta Graph API calls the Lead
// Ads integration needs. Every function takes the access token explicitly
// (resolved per page by lib/meta/processEvent.js) — nothing here reads a
// token from a global or ever returns one to a caller that could reach the
// browser.
//
// Endpoint reference (Graph API, Lead Ads):
//   GET /{leadgen-id}?fields=…          — one lead's answers + attribution
//   GET /{form-id}?fields=name,…        — the lead form
//   GET /{page-id}?fields=name,…        — page + linked Instagram account
//   POST /{page-id}/subscribed_apps      — subscribe this app to the page's
//                                          `leadgen` webhook field
//   GET /debug_token?input_token=…       — token validity / scopes / expiry
// Reading leads needs the page access token to carry `leads_retrieval`
// (plus `pages_show_list` / `pages_manage_metadata` for the page and
// subscription calls) — see README "Meta Lead Ads" for the app-review notes.

const DEFAULT_VERSION = "v26.0";
const GRAPH_TIMEOUT_MS = 8000;

function apiVersion() {
  const v = (process.env.META_GRAPH_API_VERSION || DEFAULT_VERSION).trim();
  return v.startsWith("v") ? v : `v${v}`;
}

function graphBase() {
  return `https://graph.facebook.com/${apiVersion()}`;
}

class MetaApiError extends Error {
  constructor(message, { code, subcode, type, status, fbtraceId } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.subcode = subcode;
    this.type = type;
    this.status = status;
    this.fbtraceId = fbtraceId;
  }
  // Token expired / invalid / revoked — the admin has to re-connect the page.
  // Meta signals this with OAuthException code 190 (and 102 for session
  // issues); subcodes 463/467 are the specific "expired"/"invalidated" ones.
  get isAuthError() {
    // Meta tags many unrelated errors (e.g. #100 unknown field, #200
    // permission) as OAuthException too — only treat the token ones as such.
    return this.code === 190 || this.code === 102 || this.code === 104 || this.subcode === 463 || this.subcode === 467;
  }
  // Missing permission (e.g. leads_retrieval not granted) — also needs the
  // admin, not a retry.
  get isPermissionError() {
    return this.code === 10 || (this.code >= 200 && this.code <= 299);
  }
  // Rate limited / transient — safe to retry later.
  get isTransient() {
    return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613 || this.status >= 500;
  }
  get isRetryable() {
    return !this.isAuthError && !this.isPermissionError;
  }
}

// Redacts anything token-shaped so a logged URL or error can't leak one.
function redact(text) {
  return String(text || "").replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").replace(/EAA[A-Za-z0-9]{20,}/g, "[redacted-token]");
}

async function graphRequest(path, { method = "GET", token, params = {}, timeoutMs = GRAPH_TIMEOUT_MS } = {}) {
  if (!token) throw new MetaApiError("No access token available for this request", { code: 190, type: "OAuthException" });
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, signal: controller.signal });
  } catch (err) {
    throw new MetaApiError(
      err.name === "AbortError" ? `Meta Graph API timed out after ${timeoutMs}ms` : `Meta Graph API request failed: ${redact(err.message)}`,
      { status: 0, code: 4 }
    );
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new MetaApiError(redact(e.message || `Meta Graph API returned HTTP ${res.status}`), {
      code: e.code,
      subcode: e.error_subcode,
      type: e.type,
      status: res.status,
      fbtraceId: e.fbtrace_id,
    });
  }
  return body;
}

// Every field the Lead node exposes that the CRM can use. Names
// (campaign_name etc.) need ads permissions the page token may not carry, so
// on a field error we fall back to the id-only set rather than lose the lead.
const LEAD_FIELDS_FULL = [
  "id",
  "created_time",
  "platform",
  "is_organic",
  "form_id",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "field_data",
  "custom_disclaimer_responses",
  "partner_name",
].join(",");
const LEAD_FIELDS_MINIMAL = "id,created_time,platform,is_organic,form_id,ad_id,adset_id,campaign_id,field_data";

async function getLead(leadgenId, token) {
  try {
    return await graphRequest(leadgenId, { token, params: { fields: LEAD_FIELDS_FULL } });
  } catch (err) {
    // (#100) "Tried accessing nonexisting field" / permission-scoped fields
    // — retry with the minimal set before giving up.
    if (err instanceof MetaApiError && err.code === 100) {
      return graphRequest(leadgenId, { token, params: { fields: LEAD_FIELDS_MINIMAL } });
    }
    throw err;
  }
}

async function getForm(formId, token) {
  return graphRequest(formId, { token, params: { fields: "id,name,status" } });
}

async function getPage(pageId, token) {
  try {
    return await graphRequest(pageId, { token, params: { fields: "id,name,instagram_business_account{id,username}" } });
  } catch (err) {
    // The linked Instagram account needs instagram_basic / pages_read_engagement
    // on the token; a page without those (or without an IG account) is still
    // perfectly connectable — fall back to the page itself.
    if (err instanceof MetaApiError && (err.code === 100 || err.isPermissionError)) {
      return graphRequest(pageId, { token, params: { fields: "id,name" } });
    }
    throw err;
  }
}

// Tells Meta to deliver this page's `leadgen` events to the app the token
// belongs to (webhook URL itself is configured once, on the app).
async function subscribePageToLeadgen(pageId, token) {
  return graphRequest(`${pageId}/subscribed_apps`, { method: "POST", token, params: { subscribed_fields: "leadgen" } });
}

async function getPageSubscriptions(pageId, token) {
  return graphRequest(`${pageId}/subscribed_apps`, { token, params: { fields: "id,name,subscribed_fields" } });
}

// Validity / scopes / expiry of a token, checked with the app's own
// credentials (app id|app secret as the "app access token").
async function debugToken(inputToken) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new MetaApiError("META_APP_ID / META_APP_SECRET are not set", { code: 190 });
  const body = await graphRequest("debug_token", { token: `${appId}|${appSecret}`, params: { input_token: inputToken } });
  return body.data || {};
}

// Swaps a short-lived user token (what Graph API Explorer hands out, ~1-2h)
// for a long-lived one (~60 days). Page tokens derived from a long-lived
// user token do not expire at all — which is what the CRM wants to store.
async function exchangeForLongLivedUserToken(userToken) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new MetaApiError("META_APP_ID / META_APP_SECRET are not set", { code: 190 });
  const body = await graphRequest("oauth/access_token", {
    token: userToken,
    params: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken },
  });
  return body.access_token;
}

// The Page's own access token, as seen by a user who administers it (needs
// pages_show_list / pages_manage_metadata on the user token). Returns "" if
// the user has no role on that page.
async function getPageAccessToken(pageId, userToken) {
  // /me/accounts is the documented way to obtain Page tokens for a user
  // (pages_show_list); the direct /{page}?fields=access_token form is
  // refused with "(#100) nonexisting field" for most tokens.
  let url = "me/accounts";
  let params = { fields: "id,name,access_token", limit: 100 };
  for (let page = 0; page < 10; page++) {
    const body = await graphRequest(url, { token: userToken, params });
    const match = (body.data || []).find((p) => String(p.id) === String(pageId));
    if (match?.access_token) return match.access_token;
    const next = body.paging?.cursors?.after;
    if (!next || !body.paging?.next) break;
    params = { ...params, after: next };
  }
  return "";
}

module.exports = {
  exchangeForLongLivedUserToken,
  getPageAccessToken,
  MetaApiError,
  apiVersion,
  redact,
  getLead,
  getForm,
  getPage,
  subscribePageToLeadgen,
  getPageSubscriptions,
  debugToken,
};
