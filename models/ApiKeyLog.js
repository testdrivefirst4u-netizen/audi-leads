const mongoose = require("mongoose");

// One entry per request to the public lead-ingestion endpoint (see
// pages/api/public/leads.js), PLUS one entry per outbound status-callback
// delivery attempt (see lib/statusCallback.js) — `direction` tells them
// apart. Lets the super admin answer "why didn't my CarDekho lead show up"
// (inbound) or "is CarDekho actually receiving my status updates" (outbound)
// without digging through server logs. Auto-expires after 30 days (TTL
// index on createdAt) so this doesn't grow unbounded.
const ApiKeyLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", index: true },
    sourceName: { type: String },
    direction: { type: String, enum: ["inbound", "outbound"], default: "inbound" },
    status: {
      type: String,
      enum: ["created", "duplicate", "rejected", "error", "callback_sent", "callback_failed"],
      required: true,
    },
    errorMessage: { type: String },
    ip: { type: String },
    // Truncated raw payload for debugging field-mapping issues — never the
    // full body, and only kept for the TTL window above.
    payloadSnippet: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { timestamps: false }
);

ApiKeyLogSchema.index({ apiKeyId: 1, createdAt: -1 });

module.exports = mongoose.models.ApiKeyLog || mongoose.model("ApiKeyLog", ApiKeyLogSchema);
