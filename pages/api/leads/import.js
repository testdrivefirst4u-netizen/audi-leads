const XLSX = require("xlsx");
const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const { createAgentAssigner, normalizePhoneDigits } = require("../../../lib/syncService");
const { dedupeAndCreateLead } = require("../../../lib/leadIngest");
const { canonicalModelFor, normalizeShowroom, parseSheetDate } = require("../../../lib/leadFields");
const { requireSuperAdmin } = require("../../../lib/auth");

// Serverless functions have an execution-time ceiling — each row does a
// couple of DB round-trips (dedup lookup + create/update), so a very large
// file could time out rather than fail cleanly. 2000 rows is comfortably
// under that for a single request; bigger files should be split.
const MAX_ROWS = 2000;

function findField(row, names) {
  for (const name of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase().trim() === name);
    if (key && row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { fileBase64, filename = "", sourceLabel, companyId } = req.body || {};

  if (!fileBase64) {
    return res.status(400).json({ error: "No file provided" });
  }
  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }
  const company = await Company.findById(companyId).select("_id").lean();
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  let rows;
  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  } catch (err) {
    return res.status(400).json({ error: `Couldn't read "${filename}" — is it a valid CSV/Excel file? (${err.message})` });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: "The file has no data rows" });
  }
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (${rows.length}) — split into files of ${MAX_ROWS} or fewer` });
  }

  const source = (sourceLabel && String(sourceLabel).trim()) || "Bulk Upload";
  const assignNext = await createAgentAssigner(companyId);

  let created = 0;
  let duplicate = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `Row ${i + 2}`; // +2: 1-indexed, plus the header row

    try {
      const name = findField(row, ["name", "full_name", "customer_name", "customer"]);
      const phone = normalizePhoneDigits(findField(row, ["phone", "mobile", "phone_number", "contact"]));
      const email = findField(row, ["email", "email_address"]);
      const modelRaw = findField(row, ["model", "vehicle", "car_model", "product"]) || "General Enquiry";
      const message = findField(row, ["message", "note", "remarks", "comment"]);
      const showroomRaw = findField(row, ["location", "showroom", "city"]);
      const dateRaw = findField(row, ["created_time", "created date", "date", "enquiry date"]);

      if (!phone && !email) {
        skipped++;
        continue;
      }

      const matchedModel = canonicalModelFor(modelRaw);
      const canonicalModel = matchedModel === "Other" ? modelRaw : matchedModel;
      const location = normalizeShowroom(showroomRaw);
      const sheetCreatedAt = (dateRaw && parseSheetDate(dateRaw)) || new Date();

      const { status } = await dedupeAndCreateLead({
        companyId,
        phone: phone || undefined,
        email: email || undefined,
        name,
        model: modelRaw,
        canonicalModel,
        data: { ...row, message },
        source,
        sheetCreatedAt,
        location,
        assignNext,
      });

      if (status === "duplicate") duplicate++;
      else created++;
    } catch (err) {
      errors.push(`${rowLabel}: ${err.message}`);
    }
  }

  res.status(200).json({
    totalRows: rows.length,
    created,
    duplicate,
    skipped,
    errorCount: errors.length,
    errors: errors.slice(0, 20), // cap so a bad file doesn't return a huge payload
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

export default requireSuperAdmin(handler);
