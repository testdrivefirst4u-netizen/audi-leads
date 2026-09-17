const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");

// POST /api/meta/disconnect-page { pageId } — removes the Page and its
// token from this company. Stored webhook events and leads are kept; new
// events for the page are recorded as "unmapped" until it is reconnected.
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  const pageId = String(req.body?.pageId || "").trim();
  if (!pageId) return res.status(400).json({ error: "pageId is required" });
  await connectDB();
  const result = await Settings.updateOne(
    { companyId: req.session.companyId },
    { $pull: { "meta.pages": { pageId } }, $set: { "meta.oauth.pendingPages": [], "meta.oauth.expiresAt": null } }
  );
  if (!result.matchedCount) return res.status(404).json({ error: "No Meta settings for this company" });
  res.status(200).json({ ok: true });
}

export default requireCompanyMemberOrSuperAdmin(handler);
