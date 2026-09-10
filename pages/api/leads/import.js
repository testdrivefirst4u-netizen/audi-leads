const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Settings = require("../../../models/Settings");
const ImportBatch = require("../../../models/ImportBatch");
const { createAgentAssigner, normalizePhoneDigits } = require("../../../lib/syncService");
const { dedupeAndCreateLead } = require("../../../lib/leadIngest");
const { canonicalModelFor, normalizeShowroom, parseSheetDate, resolveLocation, applySourceMap } = require("../../../lib/leadFields");
const { getLeadSource, extractLeadFields } = require("../../../lib/leadSources");
const { requireSuperAdmin } = require("../../../lib/auth");

// Same ceiling as pages/api/leads/import-preview.js — each row does a couple
// of DB round-trips (dedup lookup + create/update), so a very large file
// could time out rather than fail cleanly.
const MAX_ROWS = 2000;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { companyId, sourceSlug, mapping, rows, filename = "" } = req.body || {};

  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  const leadSource = getLeadSource(sourceSlug);
  if (!leadSource) return res.status(400).json({ error: "A valid lead source is required" });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows to import" });
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (${rows.length}) — split into files of ${MAX_ROWS} or fewer` });
  }

  const company = await Company.findById(companyId).select("_id").lean();
  if (!company) return res.status(404).json({ error: "Company not found" });

  const settings = await Settings.findOne({ companyId }).select("locationField sourceMap").lean();
  const source = applySourceMap(leadSource.name, settings?.sourceMap);
  const assignNext = await createAgentAssigner(companyId);

  let created = 0;
  let duplicate = 0;
  let skipped = 0;
  const errors = [];
  // Only brand-new documents are tracked — a row that folded into an
  // existing lead's enquiryHistory (a "duplicate") never created a
  // document, so Revoke (pages/api/leads/import-history/[batchId]/revoke.js)
  // has nothing of its own to undo for those rows.
  const createdLeadIds = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `Row ${i + 2}`; // +2: 1-indexed, plus the header row

    try {
      const extracted = extractLeadFields(row, mapping || {});
      const phone = normalizePhoneDigits(extracted.phone);
      const email = extracted.email;

      if (!phone && !email) {
        skipped++;
        continue;
      }

      const modelRaw = extracted.model || "General Enquiry";
      const matchedModel = canonicalModelFor(modelRaw);
      const canonicalModel = matchedModel === "Other" ? modelRaw : matchedModel;
      // A company with its own Settings.locationField (raw locations, not
      // Audi's showroom cities) gets that field's value verbatim instead of
      // running through normalizeShowroom() — same override syncService.js
      // and the public API apply.
      const location = settings?.locationField ? resolveLocation(row, settings.locationField) : normalizeShowroom(extracted.location);
      const sheetCreatedAt = (extracted.createdDate && parseSheetDate(extracted.createdDate)) || new Date();

      const { status, lead } = await dedupeAndCreateLead({
        companyId,
        phone: phone || undefined,
        email: email || undefined,
        name: extracted.name,
        model: modelRaw,
        canonicalModel,
        data: { ...row, message: extracted.message },
        source,
        sheetCreatedAt,
        location,
        assignNext,
        channel: leadSource.channel,
        campaign: extracted.campaign,
        campaignId: extracted.campaignId,
        adSet: extracted.adSet,
        adSetId: extracted.adSetId,
        ad: extracted.ad,
        adId: extracted.adId,
        utmSource: extracted.utmSource,
        utmMedium: extracted.utmMedium,
        utmCampaign: extracted.utmCampaign,
        utmTerm: extracted.utmTerm,
        utmContent: extracted.utmContent,
        landingPage: extracted.landingPage,
      });

      if (status === "duplicate") {
        duplicate++;
      } else {
        created++;
        createdLeadIds.push(lead._id);
      }
    } catch (err) {
      errors.push(`${rowLabel}: ${err.message}`);
    }
  }

  const batch = await ImportBatch.create({
    companyId,
    sourceSlug,
    sourceName: leadSource.name,
    filename,
    importedBy: req.session.username || "",
    totalRows: rows.length,
    created,
    duplicate,
    skipped,
    errorCount: errors.length,
    createdLeadIds,
  });

  res.status(200).json({
    batchId: batch._id,
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
