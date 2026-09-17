const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Settings = require("../../../models/Settings");
const ImportBatch = require("../../../models/ImportBatch");
const { createAgentAssigner, normalizePhoneDigits } = require("../../../lib/syncService");
const { bulkDedupeAndCreateLeads } = require("../../../lib/leadIngest");
const { canonicalModelFor, normalizeShowroom, parseSheetDate, resolveLocation, applySourceMap } = require("../../../lib/leadFields");
const { getLeadSource, extractLeadFields } = require("../../../lib/leadSources");
const { requireSuperAdmin } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");

// Rows per request. The Import Leads page splits a file into chunks of this
// size and posts them one after another, all tagged with the same batchId,
// so a 5,000-row file is ten short requests instead of one long one that
// would trip a serverless timeout. Each chunk is ingested in bulk
// (lib/leadIngest.js's bulkDedupeAndCreateLeads: one lookup + insertMany +
// bulkWrite) rather than three round-trips per row.
const MAX_ROWS_PER_REQUEST = 500;
const MAX_ROWS_PER_FILE = 5000;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { companyId, sourceSlug, mapping, rows, filename = "", batchId, totalRows, rowOffset = 0, isLast = true } = req.body || {};

  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  const leadSource = getLeadSource(sourceSlug);
  if (!leadSource) return res.status(400).json({ error: "A valid lead source is required" });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows to import" });
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return res.status(400).json({ error: `Too many rows in one request (${rows.length}) — send at most ${MAX_ROWS_PER_REQUEST} per chunk` });
  }
  if (Number(totalRows || rows.length) > MAX_ROWS_PER_FILE) {
    return res.status(400).json({ error: `Too many rows (${totalRows}) — split into files of ${MAX_ROWS_PER_FILE} or fewer` });
  }

  const company = await Company.findById(companyId).select("_id").lean();
  if (!company) return res.status(404).json({ error: "Company not found" });

  // Continuing an existing batch (chunks 2..n) or starting a new one.
  let batch = null;
  if (batchId) {
    batch = await ImportBatch.findOne({ _id: batchId, companyId });
    if (!batch) return res.status(404).json({ error: "Import batch not found" });
    if (batch.revoked) return res.status(409).json({ error: "This import batch has been revoked" });
  }

  const settings = await Settings.findOne({ companyId }).select("locationField sourceMap").lean();
  const source = applySourceMap(leadSource.name, settings?.sourceMap);
  const assignNext = await createAgentAssigner(companyId);

  // Pass 1 (pure): parse every row into ingest arguments.
  let skipped = 0;
  const errors = [];
  const entries = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `Row ${Number(rowOffset) + i + 2}`; // +2: 1-indexed, plus the header row
    try {
      const extracted = extractLeadFields(row, mapping || {});
      const phone = normalizePhoneDigits(extracted.phone);
      const email = (extracted.email || "").trim().toLowerCase();
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
      entries.push({
        phone: phone || undefined,
        email: email || undefined,
        name: extracted.name,
        model: modelRaw,
        canonicalModel,
        data: { ...row, message: extracted.message },
        source,
        sheetCreatedAt,
        location,
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
    } catch (err) {
      errors.push(`${rowLabel}: ${err.message}`);
    }
  }

  // Pass 2: one bulk write for the whole chunk.
  let created = 0;
  let duplicate = 0;
  const createdLeadIds = [];
  if (entries.length > 0) {
    try {
      const results = await bulkDedupeAndCreateLeads({ companyId, entries, assignNext });
      for (const r of results) {
        if (r.status === "duplicate") duplicate++;
        else {
          created++;
          createdLeadIds.push(r.leadId);
        }
      }
    } catch (err) {
      console.error("[import] bulk ingest failed:", err);
      return res.status(500).json({ error: `Import failed part-way: ${err.message}` });
    }
  }

  if (batch) {
    batch.totalRows += rows.length;
    batch.created += created;
    batch.duplicate += duplicate;
    batch.skipped += skipped;
    batch.errorCount += errors.length;
    batch.createdLeadIds.push(...createdLeadIds);
    await batch.save();
  } else {
    batch = await ImportBatch.create({
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
  }
  if (isLast) invalidate(`leads-meta:${companyId}`);

  res.status(200).json({
    batchId: batch._id,
    // this chunk
    chunk: { rows: rows.length, created, duplicate, skipped, errorCount: errors.length },
    // running totals for the whole batch
    totalRows: batch.totalRows,
    created: batch.created,
    duplicate: batch.duplicate,
    skipped: batch.skipped,
    errorCount: batch.errorCount,
    errors: errors.slice(0, 20), // cap so a bad file doesn't return a huge payload
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

export default requireSuperAdmin(handler);
