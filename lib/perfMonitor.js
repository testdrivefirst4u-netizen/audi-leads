// Lightweight in-memory instrumentation — records API route timings and
// MongoDB query timings into bounded ring buffers, so we can measure real
// behavior on this exact codebase instead of guessing. Deliberately not
// persisted anywhere (no new infra dependency): read via
// pages/api/debug/timings.js while diagnosing, thrown away on restart.
const MAX_SAMPLES = 1000;

const apiSamples = [];
const querySamples = [];

function recordApiTiming(route, method, durationMs, memDeltaKB, statusCode) {
  apiSamples.push({ route, method, durationMs, memDeltaKB, statusCode, at: Date.now() });
  if (apiSamples.length > MAX_SAMPLES) apiSamples.shift();
  console.log(
    `[timing:api] ${method} ${route} — ${durationMs.toFixed(1)}ms, mem Δ${memDeltaKB.toFixed(0)}KB, status ${statusCode}`
  );
}

function recordQueryTiming(model, op, durationMs) {
  querySamples.push({ model, op, durationMs, at: Date.now() });
  if (querySamples.length > MAX_SAMPLES) querySamples.shift();
  console.log(`[timing:mongo] ${model}.${op} — ${durationMs.toFixed(1)}ms`);
}

function summarize(samples, groupKey) {
  const groups = new Map();
  for (const s of samples) {
    const key = groupKey(s);
    if (!groups.has(key)) groups.set(key, { key, count: 0, totalMs: 0, maxMs: 0 });
    const g = groups.get(key);
    g.count++;
    g.totalMs += s.durationMs;
    g.maxMs = Math.max(g.maxMs, s.durationMs);
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, avgMs: g.totalMs / g.count }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

function getReport() {
  return {
    api: {
      samples: apiSamples.length,
      byRoute: summarize(apiSamples, (s) => `${s.method} ${s.route}`),
      slowestCalls: [...apiSamples].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
    },
    mongo: {
      samples: querySamples.length,
      byQuery: summarize(querySamples, (s) => `${s.model}.${s.op}`),
      slowestCalls: [...querySamples].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
    },
  };
}

function reset() {
  apiSamples.length = 0;
  querySamples.length = 0;
}

// For the handful of routes that don't go through lib/auth.js's
// requireAuth (login, logout, the cron trigger, the public ingestion
// endpoint) — same measurement, without requiring a session.
function withTiming(route, handler) {
  return async function timed(req, res) {
    const startedAt = process.hrtime.bigint();
    const memBefore = process.memoryUsage().heapUsed;
    try {
      return await handler(req, res);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const memDeltaKB = (process.memoryUsage().heapUsed - memBefore) / 1024;
      recordApiTiming(route, req.method, durationMs, memDeltaKB, res.statusCode);
    }
  };
}

module.exports = { recordApiTiming, recordQueryTiming, getReport, reset, withTiming };
