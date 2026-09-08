const connectDB = require("../../../../../lib/db");
const ApiKey = require("../../../../../models/ApiKey");
const { requireSuperAdmin } = require("../../../../../lib/auth");

const MAPPING_FIELDS = ["name", "phone", "email", "model", "message", "location"];

function sanitizeMapping(input) {
  const mapping = {};
  for (const field of MAPPING_FIELDS) {
    mapping[field] = input && input[field] !== undefined ? String(input[field]).trim() : "";
  }
  return mapping;
}

function sanitizeIps(input) {
  if (!Array.isArray(input)) return [];
  return input.map((ip) => String(ip).trim()).filter(Boolean);
}

// Only http(s) URLs are ever dispatched to (see lib/statusCallback.js) —
// reject anything else up front rather than storing a value that can never
// actually be delivered to.
function sanitizeCallbackUrl(input) {
  const url = String(input || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) throw new Error("Status Callback URL must start with http:// or https://");
  return url;
}

function toPublicKey(apiKey) {
  return {
    _id: apiKey._id,
    sourceName: apiKey.sourceName,
    keyPrefix: apiKey.keyPrefix,
    active: apiKey.active,
    lastUsedAt: apiKey.lastUsedAt,
    createdAt: apiKey.createdAt,
    fieldMapping: apiKey.fieldMapping || {},
    rateLimitPerMinute: apiKey.rateLimitPerMinute,
    allowedIps: apiKey.allowedIps || [],
    statusCallbackUrl: apiKey.statusCallbackUrl || "",
    hasCallbackSecret: Boolean(apiKey.statusCallbackSecret),
  };
}

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId, keyId } = req.query;
  const { active, fieldMapping, rateLimitPerMinute, allowedIps, statusCallbackUrl, statusCallbackSecret, clearCallbackSecret } =
    req.body || {};

  const update = {};
  if (active !== undefined) update.active = Boolean(active);
  if (fieldMapping !== undefined) update.fieldMapping = sanitizeMapping(fieldMapping);
  if (rateLimitPerMinute !== undefined) update.rateLimitPerMinute = Number(rateLimitPerMinute) || 60;
  if (allowedIps !== undefined) update.allowedIps = sanitizeIps(allowedIps);
  if (statusCallbackUrl !== undefined) {
    try {
      update.statusCallbackUrl = sanitizeCallbackUrl(statusCallbackUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  // A secret is write-only (never re-sent to the client once set, same as
  // the raw API key itself) — only overwrite it when a new value is
  // actually provided, or explicitly clear it via clearCallbackSecret.
  if (statusCallbackSecret) update.statusCallbackSecret = String(statusCallbackSecret).trim();
  else if (clearCallbackSecret) update.statusCallbackSecret = "";

  const apiKey = await ApiKey.findOneAndUpdate({ _id: keyId, companyId }, update, { new: true });
  if (!apiKey) return res.status(404).json({ error: "API key not found" });

  res.status(200).json({ apiKey: toPublicKey(apiKey) });
}

export default requireSuperAdmin(handler);
