const mongoose = require("mongoose");

// One lead-stage event sent (or due to be sent) to Meta's Conversions API —
// written by lib/meta/capi.js. `eventId` ("<dataset id>:<lead id>:<event
// name>") is unique per company, so each lead reaches each stage at most once
// per dataset even when it's moved back and forth — and switching to another
// dataset sends to it afresh. (Rows from before datasets were part of the
// key have no dataset prefix.) Failed sends are retried by the cron
// sync while Meta still accepts them (events up to 7 days old).
const CapiEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    leadName: { type: String, default: "" },
    eventId: { type: String, required: true },
    datasetId: { type: String, default: "" },
    eventName: { type: String, required: true }, // what Meta sees, e.g. "Test Drive"
    stage: { type: String, default: "" }, // the CRM status it came from
    eventTime: { type: Date, required: true }, // when the lead reached the stage
    state: { type: String, enum: ["sent", "failed"], default: "failed", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    sentAt: { type: Date },
    fbtraceId: { type: String, default: "" },
  },
  { timestamps: true }
);

CapiEventSchema.index({ companyId: 1, eventId: 1 }, { unique: true });
CapiEventSchema.index({ companyId: 1, updatedAt: -1 });
// Kept for three months: long enough to look back at, and Meta itself only
// takes events up to 7 days old.
CapiEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.models.CapiEvent || mongoose.model("CapiEvent", CapiEventSchema);
