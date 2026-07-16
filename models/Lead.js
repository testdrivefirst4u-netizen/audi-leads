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

// One entry per raw sheet row that was folded into this lead as a repeat
// enquiry for the same customer + same vehicle model (see Rule 1 in
// lib/syncService.js's dedup logic). The first enquiry that created the
// lead is also recorded here, so `enquiryHistory.length` is always the true
// total submission count for this customer+model pair.
const EnquiryHistoryEntrySchema = new mongoose.Schema(
  {
    model: { type: String }, // raw sheet tab this specific submission came from
    rowNumber: { type: Number },
    date: { type: Date },
    source: { type: String }, // "Google Sheet", or an external lead source's name (e.g. "CarDekho")
  },
  { _id: false }
);

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Won", "Lost"];
// Set once at creation and never changed afterward — whether this was the
// customer's first-ever enquiry (any model) or they already had a lead for a
// different model. Independent of `duplicateCount`, which tracks repeat
// enquiries for THIS SAME model and can grow after creation.
const LEAD_TYPES = ["new", "new_model_existing_customer"];

const LeadSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
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
    // Normalized showroom city (Hyderabad/Vijayawada/Visakhapatnam/Other),
    // computed from the sheet's raw showroom field at sync time — same
    // normalizer used for agent auto-assignment (lib/leadFields.js), stored
    // here too so it can be filtered/indexed instead of recomputed per request.
    location: { type: String, index: true },
    rowNumber: { type: Number }, // 1-based row number in the sheet (excluding header)
    contentHash: { type: String, index: true },
    // Where this lead originally came from — the Google Sheet sync, or an
    // external integration (CarDekho/CarWale/etc.) pushing via its own API key.
    source: { type: String, default: "Google Sheet", index: true },
    // CRM fields managed from the dashboard, untouched by the sheet sync.
    status: { type: String, enum: LEAD_STATUSES, default: "New", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", index: true },
    // Duplicate-detection fields (see lib/syncService.js). A "duplicate" is a
    // repeat sheet submission from the same customer (phone/email) for the
    // same canonicalModel — it never becomes its own Lead document, it just
    // updates these fields on the original.
    leadType: { type: String, enum: LEAD_TYPES, default: "new", index: true },
    duplicateCount: { type: Number, default: 0, index: true }, // enquiryHistory.length - 1
    lastEnquiryAt: { type: Date, index: true },
    enquiryHistory: { type: [EnquiryHistoryEntrySchema], default: [] },
    remarks: { type: [RemarkSchema], default: [] },
    followUps: { type: [FollowUpSchema], default: [] },
    calls: { type: [CallLogSchema], default: [] },
  },
  { timestamps: true }
);

// A raw sheet row is uniquely identified by (model, rowNumber) — sync uses
// this first to check "have I already ingested this exact row" (whether it
// became a lead's primary row or got folded into someone's enquiryHistory).
// Customer-level matching for the actual dedup decision (same phone/email +
// same canonicalModel = repeat enquiry) happens in lib/syncService.js against
// the phone/email indexes below, not against these.
LeadSchema.index({ companyId: 1, model: 1, leadId: 1 });
LeadSchema.index({ companyId: 1, model: 1, phone: 1 });
LeadSchema.index({ companyId: 1, model: 1, rowNumber: 1 });
LeadSchema.index({ companyId: 1, "enquiryHistory.model": 1, "enquiryHistory.rowNumber": 1 });

module.exports = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.LEAD_TYPES = LEAD_TYPES;
