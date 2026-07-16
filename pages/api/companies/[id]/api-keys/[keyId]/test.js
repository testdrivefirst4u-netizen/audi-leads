const connectDB = require("../../../../../../lib/db");
const ApiKey = require("../../../../../../models/ApiKey");
const { canonicalModelFor, normalizeShowroom } = require("../../../../../../lib/leadFields");
const { normalizePhoneDigits } = require("../../../../../../lib/syncService");
const { requireSuperAdmin } = require("../../../../../../lib/auth");

// Same field-resolution logic as pages/api/public/leads.js, duplicated
// deliberately (not imported) — this route never touches the Lead
// collection, it's a pure dry-run so a super admin can confirm a source's
// field mapping is right before that source ever goes live.
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

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId, keyId } = req.query;
  const samplePayload = req.body?.samplePayload;

  if (!samplePayload || typeof samplePayload !== "object") {
    return res.status(400).json({ error: "samplePayload (an object) is required" });
  }

  const apiKey = await ApiKey.findOne({ _id: keyId, companyId }).lean();
  if (!apiKey) return res.status(404).json({ error: "API key not found" });

  const mapping = apiKey.fieldMapping || {};
  const name = findField(samplePayload, ["name", "full_name", "customer_name", "customer"], mapping.name);
  const phone = normalizePhoneDigits(
    findField(samplePayload, ["phone", "mobile", "phone_number", "contact"], mapping.phone)
  );
  const email = findField(samplePayload, ["email", "email_address"], mapping.email);
  const modelRaw =
    findField(samplePayload, ["model", "vehicle", "car_model", "product"], mapping.model) || "General Enquiry";
  const message = findField(samplePayload, ["message", "note", "remarks", "comment"], mapping.message);
  const showroomRaw = findField(samplePayload, ["location", "showroom", "city"], mapping.location);

  const matchedModel = canonicalModelFor(modelRaw);
  const canonicalModel = matchedModel === "Other" ? modelRaw : matchedModel;
  const location = normalizeShowroom(showroomRaw);

  res.status(200).json({
    parsed: { name, phone, email, model: modelRaw, canonicalModel, message, location },
    wouldReject: !phone && !email,
  });
}

export default requireSuperAdmin(handler);
