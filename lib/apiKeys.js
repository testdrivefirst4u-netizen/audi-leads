const crypto = require("crypto");
const ApiKeyUsage = require("../models/ApiKeyUsage");

const KEY_PREFIX = "lead_";

// The raw key is only ever returned once, at creation time — after that only
// its hash (below) and a short display prefix are kept in the database.
function generateApiKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString("hex");
}

// SHA-256 rather than bcrypt: this needs an exact-match DB lookup on every
// inbound request (unlike a password, which is only ever compared one at a
// time against a known user), so it's hashed deterministically and indexed.
function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function displayPrefix(rawKey) {
  return rawKey.slice(0, KEY_PREFIX.length + 6) + "...";
}

// Atomically increments this key's current-minute counter and reports
// whether it's over its configured limit. Fixed-window (not sliding), which
// can let a short burst across a window boundary through — fine for
// abuse protection on a lead-ingestion endpoint, not a strict billing meter.
async function checkRateLimit(apiKeyId, limitPerMinute) {
  const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
  const usage = await ApiKeyUsage.findOneAndUpdate(
    { apiKeyId, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true }
  );
  return usage.count <= limitPerMinute;
}

module.exports = { generateApiKey, hashApiKey, displayPrefix, checkRateLimit };
