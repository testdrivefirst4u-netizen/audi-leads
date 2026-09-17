const mongoose = require("mongoose");

// One row per leadgen event Meta has ever delivered to /api/webhooks/meta —
// the audit trail behind the Meta Lead Ads page's "Recent events" and the
// retry queue for anything that didn't make it into a Lead on first try.
//
// `leadgenId` is unique: Meta redelivers the same event when it doesn't get
// a 2xx quickly enough (and sometimes anyway), so the very first thing the
// webhook does is upsert on it — a redelivery of an already-processed lead
// is a no-op, and a redelivery of a failed one just bumps `attempts`.
//
// Status lifecycle:
//   received  → stored, not yet processed (only briefly, inside one request)
//   processed → a Lead was created (leadId set)
//   duplicate → the customer already had a lead for this model; folded into
//               it as a repeat enquiry (leadId points at that lead)
//   unmapped  → no company has connected this Page ID yet; retried once a
//               company does (Retry button / daily cron)
//   failed    → Graph API / DB error; `lastError` says what, retried later
const MetaWebhookEventSchema = new mongoose.Schema(
  {
    leadgenId: { type: String, required: true, unique: true },
    pageId: { type: String, index: true },
    formId: { type: String },
    adId: { type: String },
    adgroupId: { type: String },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    status: {
      type: String,
      enum: ["received", "processed", "duplicate", "unmapped", "failed"],
      default: "received",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    platform: { type: String, default: "" },
    // Meta's own event timestamp (seconds → Date) — the lead's submit time
    // is on the Lead itself as metaCreatedTime.
    eventTime: { type: Date },
    // The `changes[].value` object exactly as delivered. Never contains
    // customer data (Meta only sends ids in the webhook), so safe to keep.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

MetaWebhookEventSchema.index({ companyId: 1, createdAt: -1 });
MetaWebhookEventSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.models.MetaWebhookEvent || mongoose.model("MetaWebhookEvent", MetaWebhookEventSchema);
