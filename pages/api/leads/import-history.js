const connectDB = require("../../../lib/db");
const ImportBatch = require("../../../models/ImportBatch");
const { requireSuperAdmin } = require("../../../lib/auth");

// Powers the Import Leads page's "Import History" list — every past
// Excel/CSV import for a company, most recent first, each with a Revoke
// action (see import-history/[batchId]/revoke.js) unless already revoked.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });

  const batches = await ImportBatch.find({ companyId }).sort({ createdAt: -1 }).limit(50).lean();

  res.status(200).json({
    batches: batches.map((b) => ({
      _id: b._id,
      sourceSlug: b.sourceSlug,
      sourceName: b.sourceName,
      filename: b.filename,
      importedBy: b.importedBy,
      totalRows: b.totalRows,
      created: b.created,
      duplicate: b.duplicate,
      skipped: b.skipped,
      createdAt: b.createdAt,
      revoked: b.revoked,
      revokedAt: b.revokedAt,
      revokedBy: b.revokedBy,
      revokedCount: b.revokedCount,
    })),
  });
}

export default requireSuperAdmin(handler);
