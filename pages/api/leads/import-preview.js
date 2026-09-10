const XLSX = require("xlsx");
const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Settings = require("../../../models/Settings");
const Lead = require("../../../models/Lead");
const { normalizePhoneDigits } = require("../../../lib/syncService");
const { canonicalModelFor } = require("../../../lib/leadFields");
const { getLeadSource, guessColumnMapping, extractLeadFields, CRM_FIELDS } = require("../../../lib/leadSources");
const { requireSuperAdmin } = require("../../../lib/auth");

// Same ceiling as pages/api/leads/import.js — this route does no writes, but
// it does one duplicate-check query per unique (model, phone/email) pair, so
// the same cap keeps a very large file from blowing the request budget.
const MAX_ROWS = 2000;
const PREVIEW_ROWS = 20;

// Read-only echo of dedupeAndCreateLead's own match rule (companyId +
// canonicalModel + phone-or-email) — this never decides anything, it only
// counts how many rows *would* fold into an existing lead, for the preview
// screen. The actual import step still defers entirely to
// lib/leadIngest.js's dedupeAndCreateLead, unchanged.
async function countDuplicates(companyId, candidates) {
  const models = [...new Set(candidates.map((c) => c.canonicalModel).filter(Boolean))];
  const phones = [...new Set(candidates.map((c) => c.phone).filter(Boolean))];
  const emails = [...new Set(candidates.map((c) => c.email).filter(Boolean))];
  if (models.length === 0 || (phones.length === 0 && emails.length === 0)) return 0;

  const or = [];
  if (phones.length) or.push({ phone: { $in: phones } });
  if (emails.length) or.push({ email: { $in: emails } });

  const existing = await Lead.find({ companyId, canonicalModel: { $in: models }, $or: or })
    .select("phone email canonicalModel")
    .lean();

  const existingKeys = new Set();
  for (const lead of existing) {
    if (lead.phone) existingKeys.add(`${lead.canonicalModel}|p|${lead.phone}`);
    if (lead.email) existingKeys.add(`${lead.canonicalModel}|e|${lead.email}`);
  }

  return candidates.filter(
    (c) =>
      (c.phone && existingKeys.has(`${c.canonicalModel}|p|${c.phone}`)) ||
      (c.email && existingKeys.has(`${c.canonicalModel}|e|${c.email}`))
  ).length;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { fileBase64, filename = "", companyId, sourceSlug, mapping: confirmedMapping } = req.body || {};

  if (!fileBase64) return res.status(400).json({ error: "No file provided" });
  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  if (!sourceSlug || !getLeadSource(sourceSlug)) {
    return res.status(400).json({ error: "A valid lead source is required" });
  }

  const company = await Company.findById(companyId).select("_id").lean();
  if (!company) return res.status(404).json({ error: "Company not found" });

  let rows;
  let headers = [];
  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  } catch (err) {
    return res.status(400).json({ error: `Couldn't read "${filename}" — is it a valid CSV/Excel file? (${err.message})` });
  }

  if (rows.length === 0) return res.status(400).json({ error: "The file has no data rows" });
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (${rows.length}) — split into files of ${MAX_ROWS} or fewer` });
  }

  const settings = await Settings.findOne({ companyId }).select("sourceColumnOverrides").lean();
  const override = (settings?.sourceColumnOverrides || []).find((o) => o.sourceSlug === sourceSlug)?.mapping;

  // A freshly-uploaded file has no confirmed mapping yet — suggest one. Once
  // the admin has edited the mapping screen, the frontend re-calls this same
  // endpoint with `mapping` set, so the preview always reflects what will
  // actually be imported.
  const { suggestedMapping, unmappedColumns } = guessColumnMapping(headers, sourceSlug, override);
  const mapping = confirmedMapping || suggestedMapping;

  const extracted = rows.map((row) => ({ ...extractLeadFields(row, mapping), row }));

  let missingContact = 0;
  const dedupeCandidates = [];
  for (const r of extracted) {
    const phone = normalizePhoneDigits(r.phone);
    const email = r.email;
    if (!phone && !email) {
      missingContact++;
      continue;
    }
    const matchedModel = canonicalModelFor(r.model);
    const canonicalModel = matchedModel === "Other" ? r.model || "General Enquiry" : matchedModel;
    dedupeCandidates.push({ phone: phone || undefined, email: email || undefined, canonicalModel });
  }

  const duplicates = await countDuplicates(companyId, dedupeCandidates);

  const preview = extracted.slice(0, PREVIEW_ROWS).map((r) => ({
    name: r.name,
    phone: r.phone,
    email: r.email,
    model: r.model,
    campaign: r.campaign,
    status: !normalizePhoneDigits(r.phone) && !r.email ? "Invalid (no phone/email)" : "Valid",
  }));

  res.status(200).json({
    headers,
    suggestedMapping,
    unmappedColumns,
    crmFields: CRM_FIELDS,
    preview,
    // Sent back so the browser can hold the parsed rows in memory and send
    // them straight to /api/leads/import once the mapping is confirmed —
    // avoids re-uploading/re-parsing the same file a second time.
    rows,
    counts: {
      totalRows: rows.length,
      missingContact,
      duplicates,
      validLeads: rows.length - missingContact,
    },
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

export default requireSuperAdmin(handler);
