const connectDB = require("../../../lib/db");
const ApiKey = require("../../../models/ApiKey");
const ApiKeyLog = require("../../../models/ApiKeyLog");
const { getSettings, createAgentAssigner, ingestTabRows } = require("../../../lib/syncService");
const { hashApiKey, checkRateLimit } = require("../../../lib/apiKeys");
const { isLocked, recordFailure } = require("../../../lib/rateLimit");
const { invalidate } = require("../../../lib/serverCache");
const { withTiming } = require("../../../lib/perfMonitor");

// Instant Google Sheet push. The scheduled sync (/api/cron/sync) reads every
// tab of every company's sheet — ~25 s for a company with 36 tabs — so on a
// once-a-day cron a new row can wait hours. This endpoint is the other
// direction: a small Apps Script attached to the sheet (see README, "Instant
// sheet push") POSTs each newly appended row here the moment it lands, and
// it becomes a lead within a second or two.
//
// Body: { sheetId?: string, tab: string, rows: [{ rowNumber: number, record: {header: value} }] }
//   rowNumber is the sheet row minus one (row 1 is the header), the same
//   numbering the sync uses — that is what makes the two idempotent
//   against each other: the daily full sync then sees these rows as
//   already ingested (same tab + rowNumber) and leaves them alone.
//
// Auth: a Lead Source API key issued for the company (Companies → API Keys),
// sent as Authorization: Bearer <key>. Same IP allowlist / rate limit /
// delivery logging as /api/public/leads.

const MAX_ROWS = 200;
const MAX_INVALID_KEY_ATTEMPTS = 20;

function extractKey(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (req.headers["x-api-key"]) return String(req.headers["x-api-key"]).trim();
  if (req.query.key) return String(req.query.key).trim();
  return "";
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

async function logDelivery(fields) {
  try {
    await ApiKeyLog.create(fields);
  } catch (err) {
    console.error("Failed to write ApiKeyLog:", err);
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();

  const ip = clientIp(req);
  const ipRateLimitKey = `public-leads-invalid:${ip || "unknown"}`;
  if (ip && (await isLocked(ipRateLimitKey, MAX_INVALID_KEY_ATTEMPTS))) {
    return res.status(429).json({ error: "Too many invalid API key attempts from this IP. Try again later." });
  }
  const rawKey = extractKey(req);
  if (!rawKey) {
    if (ip) await recordFailure(ipRateLimitKey);
    return res.status(401).json({ error: "Missing API key. Send it as 'Authorization: Bearer <key>'" });
  }
  const apiKey = await ApiKey.findOne({ keyHash: hashApiKey(rawKey), active: true });
  if (!apiKey) {
    if (ip) await recordFailure(ipRateLimitKey);
    return res.status(401).json({ error: "Invalid or revoked API key" });
  }
  const base = { companyId: apiKey.companyId, apiKeyId: apiKey._id, sourceName: apiKey.sourceName, ip };
  if (apiKey.allowedIps?.length && !apiKey.allowedIps.includes(ip)) {
    await logDelivery({ ...base, status: "rejected", errorMessage: `IP ${ip} not in allowlist` });
    return res.status(403).json({ error: "Request IP not allowed for this key" });
  }
  if (!(await checkRateLimit(apiKey._id, apiKey.rateLimitPerMinute || 60))) {
    await logDelivery({ ...base, status: "rejected", errorMessage: "Rate limit exceeded" });
    return res.status(429).json({ error: "Rate limit exceeded for this key" });
  }

  const { sheetId, tab, rows } = req.body || {};
  if (!tab || typeof tab !== "string") return res.status(400).json({ error: "tab (sheet tab name) is required" });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows must be a non-empty array" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows per request` });

  const settings = await getSettings(apiKey.companyId);
  // The tab must belong to one of the company's configured sheets when the
  // script tells us which spreadsheet it came from — a key for company A
  // can't push rows into company A under the name of a sheet it doesn't use.
  if (sheetId && !(settings.sheets || []).some((s) => s.sheetId === String(sheetId))) {
    await logDelivery({ ...base, status: "rejected", errorMessage: `Sheet ${sheetId} is not connected to this company` });
    return res.status(400).json({ error: "This spreadsheet is not connected to the company the API key belongs to" });
  }

  const records = [];
  for (const r of rows) {
    const rowNumber = Number(r?.rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || !r.record || typeof r.record !== "object") continue;
    const record = {};
    for (const [k, v] of Object.entries(r.record)) record[String(k).trim()] = v === null || v === undefined ? "" : String(v).trim();
    if (Object.values(record).some((v) => v !== "")) records.push({ rowNumber, record });
  }
  if (records.length === 0) return res.status(400).json({ error: "No usable rows (each needs rowNumber and a non-empty record)" });

  try {
    const assignNext = await createAgentAssigner(apiKey.companyId);
    const counts = await ingestTabRows({ companyId: apiKey.companyId, settings, tab, records, assignNext });
    invalidate(`leads-meta:${apiKey.companyId}`);
    await logDelivery({
      ...base,
      status: counts.newCount > 0 ? "created" : counts.duplicateCount > 0 ? "duplicate" : "created",
      errorMessage: `sheet push · ${tab}: ${counts.newCount} new, ${counts.duplicateCount} repeat, ${counts.updatedCount} updated, ${counts.skippedCount} skipped`,
    });
    res.status(200).json({ success: true, tab, ...counts });
  } catch (err) {
    console.error("[sheet-rows] ingest failed:", err);
    await logDelivery({ ...base, status: "error", errorMessage: err.message });
    res.status(500).json({ error: "Failed to ingest rows — see server logs" });
  }
}

export default withTiming("/api/public/sheet-rows", handler);
