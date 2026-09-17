const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { apiVersion } = require("../../../lib/meta/graph");
const { redirectUri } = require("../../../lib/meta/oauth");

// Per-company Meta Lead Ads settings (Pages Router equivalent of the
// requested /api/admin/meta/settings):
//   GET   → connection + webhook status for the session's company (or the
//           super admin's chosen ?companyId=), with tokens redacted
//   PATCH → connection name / business portfolio / enabled flag
// Pages (and their tokens) are managed by /api/meta/connect, since adding
// one involves Graph API calls; events live under /api/meta/events.
// Only company admins and the super admin get here — agents are refused.

function publicPage(p) {
  return {
    _id: p._id,
    pageId: p.pageId,
    pageName: p.pageName || "",
    hasToken: Boolean(p.accessTokenEnc),
    tokenPreview: p.tokenPreview || "",
    instagramAccountId: p.instagramAccountId || "",
    instagramUsername: p.instagramUsername || "",
    subscribed: Boolean(p.subscribed),
    connectedVia: p.connectedVia || (p.accessTokenEnc ? "manual" : ""),
    connectedBy: p.connectedBy || "",
    connectedAt: p.connectedAt || null,
    lastVerifiedAt: p.lastVerifiedAt || null,
    lastVerifyError: p.lastVerifyError || "",
  };
}

function webhookUrlFor(req) {
  if (process.env.META_WEBHOOK_URL) return process.env.META_WEBHOOK_URL;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}/api/webhooks/meta` : "";
}

async function handler(req, res) {
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  await connectDB();
  const companyId = req.session.companyId;

  if (req.method === "GET") {
    const settings = await Settings.findOne({ companyId }).select("meta").lean();
    const meta = settings?.meta || {};
    return res.status(200).json({
      config: {
        enabled: meta.enabled !== false,
        connectionName: meta.connectionName || "",
        businessPortfolio: meta.businessPortfolio || "",
        pages: (meta.pages || []).map(publicPage),
        lastWebhookAt: meta.lastWebhookAt || null,
        lastLeadAt: meta.lastLeadAt || null,
        lastError: meta.lastError || "",
        lastErrorAt: meta.lastErrorAt || null,
        oauth: {
          fbUserName: meta.oauth?.fbUserName || "",
          authorizedAt: meta.oauth?.authorizedAt || null,
          pendingPages: meta.oauth?.expiresAt && new Date(meta.oauth.expiresAt) > new Date() ? (meta.oauth.pendingPages || []).length : 0,
        },
      },
      app: {
        appId: process.env.META_APP_ID || "",
        appSecretSet: Boolean(process.env.META_APP_SECRET),
        verifyTokenSet: Boolean(process.env.META_VERIFY_TOKEN),
        fallbackTokenSet: Boolean(process.env.META_ACCESS_TOKEN),
        apiVersion: apiVersion(),
        webhookUrl: webhookUrlFor(req),
        oauthRedirectUri: redirectUri(req),
        loginConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
        defaultPageId: process.env.META_PAGE_ID || "",
      },
    });
  }

  if (req.method === "PATCH") {
    const { enabled, connectionName, businessPortfolio } = req.body || {};
    const update = {};
    if (enabled !== undefined) update["meta.enabled"] = Boolean(enabled);
    if (connectionName !== undefined) update["meta.connectionName"] = String(connectionName).trim().slice(0, 120);
    if (businessPortfolio !== undefined) update["meta.businessPortfolio"] = String(businessPortfolio).trim().slice(0, 120);
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Nothing to update" });
    await Settings.findOneAndUpdate({ companyId }, { $set: update }, { upsert: true });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdmin(handler);
