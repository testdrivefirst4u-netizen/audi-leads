const mongoose = require("mongoose");

const SyncLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    status: { type: String, enum: ["success", "error"], default: "success" },
    totalRows: { type: Number, default: 0 },
    newCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    unchangedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 }, // repeat enquiries folded into an existing lead, not created as new
    errorMessage: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SyncLog || mongoose.model("SyncLog", SyncLogSchema);
