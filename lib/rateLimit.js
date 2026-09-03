const RateLimitHit = require("../models/RateLimitHit");

// Read-only check — never call this instead of connectDB() at a call site;
// callers are expected to have already connected.
async function isLocked(key, limit) {
  const doc = await RateLimitHit.findOne({ key }).select("count").lean();
  return !!doc && doc.count >= limit;
}

async function recordFailure(key) {
  await RateLimitHit.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { firstAt: new Date() } },
    { upsert: true }
  );
}

async function resetLimit(key) {
  await RateLimitHit.deleteOne({ key });
}

module.exports = { isLocked, recordFailure, resetLimit };
