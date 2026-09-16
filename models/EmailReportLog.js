const mongoose = require("mongoose");

// One entry per attempted day-wise report email (scheduled or manual) —
// what the Companies panel's "Email Reports" row shows as recent history,
// and the audit trail for "did company X actually get yesterday's report?".
const EmailReportLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    reportDate: { type: String, required: true }, // "YYYY-MM-DD" in the company's report timezone
    trigger: { type: String, enum: ["scheduled", "manual"], default: "manual" },
    recipients: { type: [String], default: [] },
    status: { type: String, enum: ["sent", "error", "skipped"], default: "sent" },
    leadsOnDay: { type: Number, default: 0 },
    totalLeads: { type: Number, default: 0 },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

EmailReportLogSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.models.EmailReportLog || mongoose.model("EmailReportLog", EmailReportLogSchema);
