const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireSuperAdminForCompany } = require("../../../../lib/auth");
const { normalizePhoneDigits } = require("../../../../lib/syncService");
const { CANONICAL_MODELS } = require("../../../../lib/leadFields");

// Editing core fields and deleting a lead outright are structural changes —
// unlike status/remarks/reassignment (which any company admin/agent can do),
// these are restricted to the platform super admin only (see
// lib/auth.js's requireSuperAdminForCompany).
async function handler(req, res) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { name, phone, email, canonicalModel } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (phone !== undefined) update.phone = normalizePhoneDigits(phone);
    if (email !== undefined) update.email = String(email).trim();
    if (canonicalModel !== undefined) {
      if (!CANONICAL_MODELS.includes(canonicalModel)) {
        return res.status(400).json({ error: `canonicalModel must be one of: ${CANONICAL_MODELS.join(", ")}` });
      }
      update.canonicalModel = canonicalModel;
    }

    const lead = await Lead.findOneAndUpdate(
      { _id: id, companyId: req.session.companyId },
      { $set: update },
      { new: true }
    )
      .populate("assignedTo", "name")
      .lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    return res.status(200).json({ lead });
  }

  if (req.method === "DELETE") {
    const result = await Lead.deleteOne({ _id: id, companyId: req.session.companyId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Lead not found" });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdminForCompany(handler);
