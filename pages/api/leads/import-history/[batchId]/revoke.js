const connectDB = require("../../../../../lib/db");
const ImportBatch = require("../../../../../models/ImportBatch");
const Lead = require("../../../../../models/Lead");
const { requireSuperAdmin } = require("../../../../../lib/auth");

// Undoes one Excel/CSV import: deletes every lead it created outright,
// regardless of whether an agent has since called/remarked/changed its
// status — this is a deliberate "the whole file was wrong" undo, not a
// selective cleanup. Rows that matched an existing lead and were folded
// into its enquiryHistory (see lib/leadIngest.js) never created a document
// in the first place, so there's nothing for this to reverse for them —
// only `createdLeadIds` (brand-new leads) are ever touched.
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { batchId } = req.query;

  const batch = await ImportBatch.findById(batchId);
  if (!batch) return res.status(404).json({ error: "Import not found" });
  if (batch.revoked) return res.status(400).json({ error: "This import has already been revoked" });

  const result = await Lead.deleteMany({ _id: { $in: batch.createdLeadIds }, companyId: batch.companyId });

  batch.revoked = true;
  batch.revokedAt = new Date();
  batch.revokedBy = req.session.username || "";
  batch.revokedCount = result.deletedCount;
  await batch.save();

  res.status(200).json({
    revokedCount: result.deletedCount,
    batch: {
      _id: batch._id,
      revoked: batch.revoked,
      revokedAt: batch.revokedAt,
      revokedBy: batch.revokedBy,
      revokedCount: batch.revokedCount,
    },
  });
}

export default requireSuperAdmin(handler);
