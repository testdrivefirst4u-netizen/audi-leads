const mongoose = require("mongoose");

// Generic short-lived failure counter for abuse protection — separate from
// lib/apiKeys.js's checkRateLimit, which meters already-authenticated API
// key usage. This tracks bad-actor patterns (failed logins, invalid API
// keys) keyed by whatever the caller chooses (username, IP, etc.), and
// self-expires via the TTL index below so lockouts are always temporary and
// nothing needs a cleanup job.
const RateLimitHitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  // TTL index — the document (and therefore the lockout window) auto-expires
  // 15 minutes after the FIRST hit, regardless of how many more come in.
  firstAt: { type: Date, default: Date.now, expires: 900 },
});

module.exports = mongoose.models.RateLimitHit || mongoose.model("RateLimitHit", RateLimitHitSchema);
