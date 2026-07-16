const mongoose = require("mongoose");

// Fixed-window rate-limit counters for the public lead-ingestion endpoint.
// One document per (apiKeyId, windowStart-rounded-to-the-minute); each
// request increments its window's count atomically. TTL-expires after 2
// minutes — only the current and previous window are ever relevant.
const ApiKeyUsageSchema = new mongoose.Schema({
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", required: true },
  windowStart: { type: Date, required: true, expires: 120 },
  count: { type: Number, default: 0 },
});

ApiKeyUsageSchema.index({ apiKeyId: 1, windowStart: 1 }, { unique: true });

module.exports = mongoose.models.ApiKeyUsage || mongoose.model("ApiKeyUsage", ApiKeyUsageSchema);
