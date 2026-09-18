const connectDB = require("../../../../lib/db");
const Settings = require("../../../../models/Settings");
const { requireAuth } = require("../../../../lib/auth");
const { encryptSecret } = require("../../../../lib/meta/crypto");
const { redact, MetaApiError } = require("../../../../lib/meta/graph");
const {
  verifyState,
  readStateCookie,
  stateCookie,
  redirectUri,
  exchangeCode,
  fetchProfile,
  fetchGrantedScopes,
  fetchManagedPages,
} = require("../../../../lib/meta/oauth");

const PENDING_TTL_MS = 15 * 60 * 1000;

// GET /api/auth/meta/callback — Facebook sends the admin back here with
// ?code=&state= (or ?error=). Everything sensitive happens server-side:
// the code is exchanged with the app secret, the user's Pages (each with
// its own Page token) are fetched and stored encrypted as *pending* on the
// company's Settings, and the browser is redirected back to the Meta Lead
// Ads page, which then shows the page picker. Tokens never reach the
// browser; the redirect carries only a status flag and a human message.
function back(res, returnTo, params) {
  const url = new URL(returnTo, "http://placeholder"); // base unused — only path + query are kept
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.setHeader("Set-Cookie", stateCookie("", 0)); // clear the state cookie
  res.redirect(302, `${url.pathname}${url.search}`);
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const rawState = String(req.query.state || "");
  const state = verifyState(rawState);
  const cookieState = readStateCookie(req);
  if (!state || !cookieState || cookieState !== rawState) {
    return back(res, "/meta-integration", { fb: "error", reason: "Login session expired or invalid - please click Connect Facebook again" });
  }
  const returnTo = state.returnTo || "/meta-integration";

  // The admin who started the flow must be the one finishing it (same
  // company, or the super admin).
  const session = req.session;
  if (session.role !== "super_admin") {
    return back(res, returnTo, { fb: "error", reason: "Not authorised to connect this company" });
  }
  const companyId = state.companyId;

  if (req.query.error) {
    const reason = String(req.query.error_description || req.query.error_reason || req.query.error);
    return back(res, returnTo, { fb: "error", reason: /user_denied/i.test(reason) ? "Facebook login was cancelled" : reason });
  }
  const code = String(req.query.code || "");
  if (!code) return back(res, returnTo, { fb: "error", reason: "Facebook did not return an authorisation code" });

  try {
    await connectDB();
    const userToken = await exchangeCode(code, redirectUri(req));
    const [profile, scopes, pages] = await Promise.all([fetchProfile(userToken), fetchGrantedScopes(userToken), fetchManagedPages(userToken)]);

    await Settings.findOneAndUpdate(
      { companyId },
      {
        $set: {
          "meta.oauth": {
            fbUserId: profile.id || "",
            fbUserName: profile.name || "",
            authorizedAt: new Date(),
            grantedScopes: scopes,
            expiresAt: new Date(Date.now() + PENDING_TTL_MS),
            pendingPages: pages.map((p) => ({
              pageId: p.pageId,
              pageName: p.pageName,
              accessTokenEnc: p.accessToken ? encryptSecret(p.accessToken) : "",
              instagramAccountId: p.instagramAccountId,
              instagramUsername: p.instagramUsername,
              tasks: p.tasks,
            })),
          },
        },
      },
      { upsert: true }
    );

    if (pages.length === 0) {
      return back(res, returnTo, {
        fb: "nopages",
        reason: `${profile.name || "This Facebook account"} does not manage any Facebook Page (or none was selected in the login dialog)`,
      });
    }
    return back(res, returnTo, { fb: "pick" });
  } catch (err) {
    const message = err instanceof MetaApiError ? `Meta: ${redact(err.message)}` : redact(err.message);
    console.error("[meta-oauth] callback failed:", message);
    return back(res, returnTo, { fb: "error", reason: message });
  }
}

export default requireAuth(handler);
