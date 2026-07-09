const mongoose = require("mongoose");

const RemarkSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const FollowUpSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    note: { type: String, default: "" },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const CallLogSchema = new mongoose.Schema(
  {
    calledAt: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: true }
);

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Won", "Lost"];

const LeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, index: true, sparse: true },
    phone: { type: String, index: true, sparse: true },
    name: { type: String },
    email: { type: String },
    model: { type: String, index: true }, // source sheet tab, e.g. "Q3", "A6"
    canonicalModel: { type: String, index: true }, // folded down for filtering/charts, e.g. "Q5 jun" -> "Q5"
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // full row, keyed by sheet header
    // Parsed from the sheet's own "created_time" column — the date the lead
    // actually came in. Distinct from Mongoose's createdAt below, which is
    // only when *we* first synced the row (can lag behind, e.g. after a
    // full resync every row gets a fresh createdAt even though the lead is old).
    sheetCreatedAt: { type: Date, index: true },
    rowNumber: { type: Number }, // 1-based row number in the sheet (excluding header)
    contentHash: { type: String, index: true },
    // CRM fields managed from the dashboard, untouched by the sheet sync.
    status: { type: String, enum: LEAD_STATUSES, default: "New", index: true },
    remarks: { type: [RemarkSchema], default: [] },
    followUps: { type: [FollowUpSchema], default: [] },
    calls: { type: [CallLogSchema], default: [] },
  },
  { timestamps: true }
);

// Sync dedupes by (model, rowNumber) — see lib/syncService.js. Repeat
// submissions from the same phone/lead ID are kept as separate leads, so
// these indexes exist only to speed up search/filtering by phone or ID,
// not for uniqueness.
LeadSchema.index({ model: 1, leadId: 1 });
LeadSchema.index({ model: 1, phone: 1 });
LeadSchema.index({ model: 1, rowNumber: 1 });

module.exports = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);
module.exports.LEAD_STATUSES = LEAD_STATUSES;
