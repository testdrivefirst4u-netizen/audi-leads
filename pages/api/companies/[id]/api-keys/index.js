const connectDB = require("../../../../../lib/db");
const ApiKey = require("../../../../../models/ApiKey");
const Company = require("../../../../../models/Company");
const { requireSuperAdmin } = require("../../../../../lib/auth");
const { generateApiKey, hashApiKey, displayPrefix } = require("../../../../../lib/apiKeys");

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
  await connectDB();
  const { id: companyId } = req.query;

  if (req.method === "GET") {
    const keys = await ApiKey.find({ companyId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ apiKeys: keys.map(toPublicKey) });
  }

  if (req.method === "POST") {
    const { sourceName, fieldMapping, rateLimitPerMinute, allowedIps } = req.body || {};
    if (!sourceName || !sourceName.trim()) {
      return res.status(400).json({ error: "Source name is required (e.g. CarDekho, CarWale, Website Form)" });
    }

    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const rawKey = generateApiKey();
    const apiKey = await ApiKey.create({
      companyId,
      sourceName: sourceName.trim(),
      keyHash: hashApiKey(rawKey),
      keyPrefix: displayPrefix(rawKey),
      active: true,
      fieldMapping: sanitizeMapping(fieldMapping),
      rateLimitPerMinute: rateLimitPerMinute ? Number(rateLimitPerMinute) : 60,
      allowedIps: sanitizeIps(allowedIps),
    });

    // The only time the raw key is ever available — the caller must copy it
    // now, it can't be retrieved again afterward (only keyPrefix is stored).
    return res.status(201).json({ apiKey: toPublicKey(apiKey), rawKey });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdmin(handler);
