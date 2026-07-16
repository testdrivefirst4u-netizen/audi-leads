const connectDB = require("../../../lib/db");
const ApiKey = require("../../../models/ApiKey");
const ApiKeyLog = require("../../../models/ApiKeyLog");
const { createAgentAssigner, normalizePhoneDigits } = require("../../../lib/syncService");
const { dedupeAndCreateLead } = require("../../../lib/leadIngest");
const { canonicalModelFor, normalizeShowroom } = require("../../../lib/leadFields");
const { hashApiKey, checkRateLimit } = require("../../../lib/apiKeys");

// Public, unauthenticated-by-cookie endpoint for external lead sources
// (CarDekho, CarWale, a website form, etc.) — authenticated instead by the
// API key a super admin issued for that specific source (see
// pages/api/companies/[id]/api-keys). Runs new leads through the exact same
// dedup + auto-assignment pipeline as the Google Sheet sync (lib/leadIngest.js),
// so a CarDekho lead for a customer who already has a Q5 enquiry behaves
// identically to a repeat row in the sheet.

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

// Checks the source's own configured field mapping first (e.g. CarDekho's
// key might say its customer-name field is "candidate_name") before falling
// back to a list of common aliases — so a source with an unmapped/blank
// mapping still works via auto-detection, and a mapped one is exact.
function findField(body, names, mappedName) {
  if (mappedName) {
    const key = Object.keys(body).find((k) => k.toLowerCase() === mappedName.toLowerCase());
    if (key && body[key] !== undefined && body[key] !== null && String(body[key]).trim()) {
      return String(body[key]).trim();
    }
  }
  for (const name of names) {
    const key = Object.keys(body).find((k) => k.toLowerCase() === name);
    if (key && body[key] !== undefined && body[key] !== null && String(body[key]).trim()) {
      return String(body[key]).trim();
    }
  }
  return "";
}

function snippet(body) {
  try {
    return JSON.stringify(body).slice(0, 1000);
  } catch {
    return "";
  }
}

async function logDelivery({ companyId, apiKeyId, sourceName, status, errorMessage, ip, body }) {
  try {
    await ApiKeyLog.create({ companyId, apiKeyId, sourceName, status, errorMessage, ip, payloadSnippet: snippet(body) });
  } catch (err) {
    console.error("Failed to write ApiKeyLog:", err);
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();

  const ip = clientIp(req);
  const body = req.body || {};

  const rawKey = extractKey(req);
  if (!rawKey) {
    return res.status(401).json({ error: "Missing API key. Send it as 'Authorization: Bearer <key>', 'X-Api-Key', or ?key=" });
  }

  const apiKey = await ApiKey.findOne({ keyHash: hashApiKey(rawKey), active: true });
  if (!apiKey) {
    return res.status(401).json({ error: "Invalid or revoked API key" });
  }

  if (apiKey.allowedIps?.length && !apiKey.allowedIps.includes(ip)) {
    await logDelivery({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status: "rejected",
      errorMessage: `IP ${ip} not in allowlist`,
      ip,
      body,
    });
    return res.status(403).json({ error: "Request IP not allowed for this key" });
  }

  const withinLimit = await checkRateLimit(apiKey._id, apiKey.rateLimitPerMinute || 60);
  if (!withinLimit) {
    await logDelivery({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status: "rejected",
      errorMessage: "Rate limit exceeded",
      ip,
      body,
    });
    return res.status(429).json({ error: "Rate limit exceeded for this key" });
  }

  apiKey.lastUsedAt = new Date();
  apiKey.save().catch(() => {});

  const mapping = apiKey.fieldMapping || {};
  const name = findField(body, ["name", "full_name", "customer_name", "customer"], mapping.name);
  const phone = normalizePhoneDigits(
    findField(body, ["phone", "mobile", "phone_number", "contact"], mapping.phone)
  );
  const email = findField(body, ["email", "email_address"], mapping.email);
  const modelRaw = findField(body, ["model", "vehicle", "car_model", "product"], mapping.model) || "General Enquiry";
  const message = findField(body, ["message", "note", "remarks", "comment"], mapping.message);
  const showroomRaw = findField(body, ["location", "showroom", "city"], mapping.location);

  if (!phone && !email) {
    await logDelivery({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status: "error",
      errorMessage: "At least one of phone or email is required",
      ip,
      body,
    });
    return res.status(400).json({ error: "At least one of phone or email is required" });
  }

  try {
    // Falls back to the raw model name itself (rather than lumping every
    // non-Audi-tab-shaped value into "Other") so an external source's own
    // vehicle naming still shows up meaningfully in filters/charts.
    const matchedModel = canonicalModelFor(modelRaw);
    const canonicalModel = matchedModel === "Other" ? modelRaw : matchedModel;
    const location = normalizeShowroom(showroomRaw);
    const assignNext = await createAgentAssigner(apiKey.companyId);

    const { lead, status } = await dedupeAndCreateLead({
      companyId: apiKey.companyId,
      phone: phone || undefined,
      email: email || undefined,
      name,
      model: modelRaw,
      canonicalModel,
      data: { ...body, message },
      source: apiKey.sourceName,
      sheetCreatedAt: new Date(),
      location,
      assignNext,
    });

    await logDelivery({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status,
      ip,
      body,
    });

    res.status(201).json({ success: true, status, leadId: lead._id });
  } catch (err) {
    await logDelivery({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status: "error",
      errorMessage: err.message,
      ip,
      body,
    });
    res.status(500).json({ error: "Failed to process lead" });
  }
}

export default handler;
