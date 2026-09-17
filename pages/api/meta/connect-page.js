const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { decryptSecret, tokenPreview } = require("../../../lib/meta/crypto");
const { subscribePageToLeadgen, redact } = require("../../../lib/meta/graph");

// POST /api/meta/connect-page { pageId } — the admin picked a Page from the
// OAuth list. Moves that page (and its encrypted Page token) into the
// company's connected pages, subscribes it to the leadgen webhook, and
// discards the rest of the pending list so no unused tokens linger.
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  const pageId = String(req.body?.pageId || "").trim();
  if (!/^\d{5,25}$/.test(pageId)) return res.status(400).json({ error: "Invalid Page ID" });

  await connectDB();
  const companyId = req.session.companyId;
  const settings = await Settings.findOne({ companyId });
  const oauth = settings?.meta?.oauth;
  if (!oauth?.pendingPages?.length || !oauth.expiresAt || oauth.expiresAt < new Date()) {
    return res.status(409).json({ error: "The Facebook login has expired - click Connect Facebook again" });
  }
  const chosen = oauth.pendingPages.find((p) => p.pageId === pageId);
  if (!chosen) return res.status(400).json({ error: "That Page was not in the list your Facebook account can manage" });
  if (!chosen.accessTokenEnc) {
    return res.status(400).json({ error: "Facebook did not provide an access token for this Page - your account may lack the Manage role on it" });
  }

  const other = await Settings.findOne({ "meta.pages.pageId": pageId, companyId: { $ne: companyId } }).select("companyId").lean();
  if (other) return res.status(409).json({ error: "This Page is already connected to another company" });

  const pageToken = decryptSecret(chosen.accessTokenEnc);
  const entry = {
    pageId,
    pageName: chosen.pageName || "",
    accessTokenEnc: chosen.accessTokenEnc,
    tokenPreview: tokenPreview(pageToken),
    instagramAccountId: chosen.instagramAccountId || "",
    instagramUsername: chosen.instagramUsername || "",
    subscribed: false,
    connectedVia: "oauth",
    connectedBy: oauth.fbUserName || "",
    connectedAt: new Date(),
    lastVerifiedAt: new Date(),
    lastVerifyError: "",
  };

  // Subscribe the page to leadgen straight away; a failure here is reported
  // but doesn't undo the connection (the Subscribe button can retry).
  let subscribeError = "";
  try {
    const result = await subscribePageToLeadgen(pageId, pageToken);
    entry.subscribed = Boolean(result?.success);
  } catch (err) {
    subscribeError = redact(err.message);
    entry.lastVerifyError = `Could not subscribe to leadgen: ${subscribeError}`;
  }

  const existingIdx = settings.meta.pages.findIndex((p) => p.pageId === pageId);
  if (existingIdx >= 0) settings.meta.pages[existingIdx] = { ...settings.meta.pages[existingIdx].toObject(), ...entry };
  else settings.meta.pages.push(entry);
  settings.meta.oauth.pendingPages = [];
  settings.meta.oauth.expiresAt = null;
  settings.meta.lastError = "";
  await settings.save();

  res.status(200).json({
    ok: true,
    page: { pageId, pageName: entry.pageName, instagramUsername: entry.instagramUsername, subscribed: entry.subscribed },
    subscribeError: subscribeError || undefined,
  });
}

export default requireCompanyMemberOrSuperAdmin(handler);
