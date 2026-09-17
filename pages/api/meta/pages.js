const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");

// GET /api/meta/pages — the Pages the admin's Facebook account can manage,
// fetched by the OAuth callback and waiting to be chosen. Ids/names only;
// the tokens stay encrypted in the database.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  await connectDB();
  const companyId = req.session.companyId;
  const settings = await Settings.findOne({ companyId }).select("meta").lean();
  const oauth = settings?.meta?.oauth || {};
  const expired = !oauth.expiresAt || new Date(oauth.expiresAt) < new Date();
  const connectedIds = new Set((settings?.meta?.pages || []).map((p) => p.pageId));

  // A page already connected to a different company can't be picked here.
  const pending = expired ? [] : oauth.pendingPages || [];
  const others = pending.length
    ? await Settings.find({ "meta.pages.pageId": { $in: pending.map((p) => p.pageId) }, companyId: { $ne: companyId } })
        .select("meta.pages.pageId")
        .lean()
    : [];
  const takenElsewhere = new Set(others.flatMap((s) => (s.meta?.pages || []).map((p) => p.pageId)));

  res.status(200).json({
    fbUserName: oauth.fbUserName || "",
    authorizedAt: oauth.authorizedAt || null,
    grantedScopes: oauth.grantedScopes || [],
    expired,
    pages: pending.map((p) => ({
      pageId: p.pageId,
      pageName: p.pageName,
      instagramUsername: p.instagramUsername || "",
      hasToken: Boolean(p.accessTokenEnc),
      canManage: !p.tasks?.length || p.tasks.includes("MANAGE"),
      alreadyConnected: connectedIds.has(p.pageId),
      connectedToOtherCompany: takenElsewhere.has(p.pageId),
    })),
  });
}

export default requireCompanyMemberOrSuperAdmin(handler);
