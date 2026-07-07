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

const LeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, index: true, sparse: true },
    phone: { type: String, index: true, sparse: true },
    name: { type: String },
    email: { type: String },
    model: { type: String, index: true }, // source sheet tab, e.g. "Q3", "A6"
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // full row, keyed by sheet header
    rowNumber: { type: Number }, // 1-based row number in the sheet (excluding header)
    contentHash: { type: String, index: true },
    // CRM fields managed from the dashboard, untouched by the sheet sync.
    remarks: { type: [RemarkSchema], default: [] },
    followUps: { type: [FollowUpSchema], default: [] },
  },
  { timestamps: true }
);

// A lead is uniquely identified by (model, leadId) when present, otherwise by (model, phone).
LeadSchema.index({ model: 1, leadId: 1 });
LeadSchema.index({ model: 1, phone: 1 });

module.exports = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);
