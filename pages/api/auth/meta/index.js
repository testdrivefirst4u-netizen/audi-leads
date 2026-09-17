const { requireCompanyMemberOrSuperAdmin } = require("../../../../lib/auth");
const { createState, stateCookie, redirectUri, buildAuthorizeUrl } = require("../../../../lib/meta/oauth");

// GET /api/auth/meta — start "Connect Facebook" (Facebook Login for
// Business). Requires an admin session (agents are refused); the super
// admin passes ?companyId= like every other company-scoped route. Sets a
// signed, 10-minute state cookie and sends the browser to Facebook's
// authorisation dialog. Nothing secret is placed in the URL.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(500).json({ error: "META_APP_ID / META_APP_SECRET are not configured on the server" });
  }
  const returnTo =
    req.session.role === "super_admin" ? `/meta-integration?companyId=${encodeURIComponent(req.session.companyId)}` : "/meta-integration";
  const state = createState({ companyId: req.session.companyId, returnTo });
  res.setHeader("Set-Cookie", stateCookie(state));
  res.redirect(302, buildAuthorizeUrl({ state, redirect: redirectUri(req) }));
}

export default requireCompanyMemberOrSuperAdmin(handler);
