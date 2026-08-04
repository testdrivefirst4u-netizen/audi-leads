// Tiny in-memory TTL cache for expensive, read-mostly, short-lived server
// data (aggregate stats, distinct-value lists, branding lookups) that gets
// hit far more often than the underlying data actually changes — e.g. a
// dashboard polling every few seconds against data that only updates once
// per sync run. Deliberately NOT cross-instance (no Redis/KV): each warm
// serverless instance keeps its own small Map, which is exactly enough to
// collapse a burst of near-simultaneous polls into one real computation.
// A cold instance just recomputes once — never stale beyond `ttlMs`, never
// wrong, no new infra dependency.
const store = new Map();

// key: a cache key string (caller composes it, e.g. `${companyId}:${month}`).
// ttlMs: how long a cached value stays valid.
// compute: async () => value — only called on a miss/expiry.
async function withCache(key, ttlMs, compute) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await compute();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

// For mutation endpoints to call after changing data a cached read depends
// on, so the next read isn't stuck serving a stale value for the rest of
// the TTL window. `prefix` clears every key starting with it (e.g. a
// companyId) since most cache keys are namespaced that way.
function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { withCache, invalidate };
