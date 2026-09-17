const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { getPage, subscribePageToLeadgen, getPageSubscriptions, debugToken, MetaApiError, redact } = require("../../../lib/meta/graph");
const { encryptSecret, decryptSecret, tokenPreview } = require("../../../lib/meta/crypto");

// Manages the Facebook Pages connected to a company. POST { action, … }:
//   connect   { pageId, accessToken? }  — verify the page (and token) with
//                                          Graph, then save it; a page may
//                                          only belong to one company
//   verify    { pageId }                 — re-check the stored token: page
//                                          still readable, token scopes /
//                                          expiry via /debug_token
//   subscribe { pageId }                 — POST /{page}/subscribed_apps
//                                          (subscribed_fields=leadgen)
//   remove    { pageId }                 — disconnect (events already stored
//                                          are kept; new ones become
//                                          "unmapped")
// Tokens go straight from the request body into encrypted storage; the
// response never includes one.

const REQUIRED_SCOPES = ["leads_retrieval", "pages_show_list", "pages_manage_metadata"];

function tokenFor(page) {
  if (page?.accessTokenEnc) return decryptSecret(page.accessTokenEnc);
  return process.env.META_ACCESS_TOKEN || "";
}

async function inspectToken(token) {
  try {
    const info = await debugToken(token);
    const scopes = info.scopes || [];
    const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    return {
      valid: Boolean(info.is_valid),
      type: info.type || "",
      expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null, // 0 = never
      scopes,
      missingScopes: missing,
    };
  } catch (err) {
    // debug_token needs the app id/secret; without them we still verified
    // the page itself, so just report that this check was unavailable.
    return { valid: null, unavailable: redact(err.message) };
  }
}

async function handler(req, res) {
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const companyId = req.session.companyId;
  const { action, pageId: rawPageId, accessToken: rawToken } = req.body || {};
  const pageId = String(rawPageId || "").trim();
  if (!/^\d{5,25}$/.test(pageId)) return res.status(400).json({ error: "pageId must be a numeric Facebook Page ID" });

  const settings = (await Settings.findOne({ companyId })) || (await Settings.create({ companyId }));
  const pages = settings.meta?.pages || [];
  const existing = pages.find((p) => p.pageId === pageId);

  try {
    if (action === "connect") {
      const owner = await Settings.findOne({ "meta.pages.pageId": pageId, companyId: { $ne: companyId } }).select("companyId").lean();
      if (owner) return res.status(409).json({ error: "This Page is already connected to another company" });

      const token = String(rawToken || "").trim() || (existing ? tokenFor(existing) : process.env.META_ACCESS_TOKEN || "");
      if (!token) return res.status(400).json({ error: "A Page access token is required (or set META_ACCESS_TOKEN on the server)" });

      const page = await getPage(pageId, token);
      const tokenInfo = await inspectToken(token);
      const entry = {
        pageId,
        pageName: page.name || "",
        accessTokenEnc: rawToken ? encryptSecret(token) : existing?.accessTokenEnc || "",
        tokenPreview: rawToken ? tokenPreview(token) : existing?.tokenPreview || "",
        instagramAccountId: page.instagram_business_account?.id || "",
        instagramUsername: page.instagram_business_account?.username || "",
        subscribed: existing?.subscribed || false,
        connectedAt: existing?.connectedAt || new Date(),
        lastVerifiedAt: new Date(),
        lastVerifyError: tokenInfo.missingScopes?.length ? `Token is missing permissions: ${tokenInfo.missingScopes.join(", ")}` : "",
      };
      if (existing) Object.assign(existing, entry);
      else settings.meta.pages.push(entry);
      await settings.save();
      return res.status(200).json({ ok: true, page: { pageId, pageName: entry.pageName, instagramUsername: entry.instagramUsername }, tokenInfo });
    }

    if (!existing) return res.status(404).json({ error: "This Page is not connected to this company" });

    if (action === "verify") {
      const token = tokenFor(existing);
      const page = await getPage(pageId, token);
      const tokenInfo = await inspectToken(token);
      let subscribed = existing.subscribed;
      try {
        const subs = await getPageSubscriptions(pageId, token);
        const mine = (subs.data || []).find((a) => !process.env.META_APP_ID || String(a.id) === String(process.env.META_APP_ID));
        subscribed = Boolean(mine && (mine.subscribed_fields || []).includes("leadgen"));
      } catch {
        /* subscription listing needs pages_manage_metadata; keep the stored flag */
      }
      existing.pageName = page.name || existing.pageName;
      existing.instagramAccountId = page.instagram_business_account?.id || "";
      existing.instagramUsername = page.instagram_business_account?.username || "";
      existing.subscribed = subscribed;
      existing.lastVerifiedAt = new Date();
      existing.lastVerifyError = tokenInfo.missingScopes?.length ? `Token is missing permissions: ${tokenInfo.missingScopes.join(", ")}` : "";
      await settings.save();
      return res.status(200).json({ ok: true, tokenInfo, subscribed });
    }

    if (action === "subscribe") {
      const token = tokenFor(existing);
      const result = await subscribePageToLeadgen(pageId, token);
      existing.subscribed = Boolean(result?.success);
      existing.lastVerifiedAt = new Date();
      existing.lastVerifyError = "";
      await settings.save();
      return res.status(200).json({ ok: true, subscribed: existing.subscribed });
    }

    if (action === "remove") {
      settings.meta.pages = pages.filter((p) => p.pageId !== pageId);
      await settings.save();
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    const message = redact(err.message);
    if (err instanceof MetaApiError) {
      if (existing && (err.isAuthError || err.isPermissionError)) {
        existing.lastVerifyError = message;
        await settings.save().catch(() => {});
      }
      return res.status(err.isAuthError ? 401 : 502).json({
        error: err.isAuthError ? `Meta rejected the access token: ${message}` : `Meta Graph API error: ${message}`,
        code: err.code,
      });
    }
    console.error("[meta-connect] failed:", message);
    return res.status(500).json({ error: "Could not complete the request. Please try again." });
  }
}

export default requireCompanyMemberOrSuperAdmin(handler);
