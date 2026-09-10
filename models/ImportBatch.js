const mongoose = require("mongoose");

// One document per Excel/CSV import run (pages/api/leads/import.js) — lets
// the Import Leads page list past imports and, if the wrong file/mapping
// was used, revoke one: delete the leads it created (see
// pages/api/leads/import-history/[batchId]/revoke.js). `createdLeadIds` is
// the only thing revoke needs — a row that matched an existing lead and got
// folded into that lead's enquiryHistory (a "duplicate") never created a
// document, so it isn't tracked here and revoke never touches it.
const ImportBatchSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    sourceSlug: { type: String, required: true },
    sourceName: { type: String, required: true },
    filename: { type: String, default: "" },
    importedBy: { type: String, default: "" },
    totalRows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    duplicate: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    createdLeadIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    revoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date },
    revokedBy: { type: String },
    // Set only once a revoke actually runs — how many of createdLeadIds
    // still existed to delete (could be fewer than `created` if a lead was
    // separately deleted by hand before the revoke).
    revokedCount: { type: Number },
  },
  { timestamps: true }
);

ImportBatchSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.models.ImportBatch || mongoose.model("ImportBatch", ImportBatchSchema);
