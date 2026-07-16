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
  };
}

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId, keyId } = req.query;
  const { active, fieldMapping, rateLimitPerMinute, allowedIps } = req.body || {};

  const update = {};
  if (active !== undefined) update.active = Boolean(active);
  if (fieldMapping !== undefined) update.fieldMapping = sanitizeMapping(fieldMapping);
  if (rateLimitPerMinute !== undefined) update.rateLimitPerMinute = Number(rateLimitPerMinute) || 60;
  if (allowedIps !== undefined) update.allowedIps = sanitizeIps(allowedIps);

  const apiKey = await ApiKey.findOneAndUpdate({ _id: keyId, companyId }, update, { new: true });
  if (!apiKey) return res.status(404).json({ error: "API key not found" });

  res.status(200).json({ apiKey: toPublicKey(apiKey) });
}

export default requireSuperAdmin(handler);
