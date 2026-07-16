const crypto = require("crypto");
const connectDB = require("./db");
const Lead = require("../models/Lead");
const SyncLog = require("../models/SyncLog");
const Settings = require("../models/Settings");
const Agent = require("../models/Agent");
const { fetchSheetRows, listSheetTabs } = require("./googleSheets");
const { canonicalModelFor, parseSheetDate, normalizeShowroom, FIELD_MATCHERS } = require("./leadFields");
const { dedupeAndCreateLead } = require("./leadIngest");

// Builds a picker that hands out the currently-least-loaded active agent (within
// this one company) for each new lead, keeping an in-memory running count so a
// single sync batch (which can create many leads in one pass) stays evenly
// balanced instead of re-querying Mongo for counts on every row. Location-aware:
// a lead's showroom is matched against each agent's `location` first (an empty
// location means "general pool", covering any showroom); only if no agent
// covers that specific location does it fall back to the least-loaded agent
// across the company, so a lead never goes unassigned just because its city
// has nobody dedicated to it.
async function createAgentAssigner(companyId) {
  const agents = await Agent.find({ active: true, companyId }).lean();
  if (agents.length === 0) return () => undefined;

  const counts = await Lead.aggregate([
    { $match: { companyId, assignedTo: { $ne: null } } },
    { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(agents.map((a) => [String(a._id), 0]));
  for (const c of counts) {
    const key = String(c._id);
    if (countMap.has(key)) countMap.set(key, c.count);
  }

  const allIds = agents.map((a) => String(a._id));

  function pickLeast(candidateIds) {
    let leastId = null;
    let leastCount = Infinity;
    for (const id of candidateIds) {
      const count = countMap.get(id);
      if (count < leastCount) {
        leastCount = count;
        leastId = id;
      }
    }
    if (leastId !== null) countMap.set(leastId, leastCount + 1);
    return leastId;
  }

  return function assignNext(location) {
    if (location) {
      const local = agents.filter((a) => a.location === location).map((a) => String(a._id));
      if (local.length > 0) return pickLeast(local);
    }
    return pickLeast(allIds);
  };
}

function hashRecord(record) {
  return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function findField(record, patterns) {
  const keys = Object.keys(record);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k));
    if (key && record[key]) return record[key];
  }
  return "";
}

// Meta's CRM-style export prefixes IDs with a type tag — "l:123", "p:+9198…",
// "ag:456" (ad), "c:789" (campaign), "f:012" (form), "as:345" (adset) — only
// on ID-shaped columns, never free-text ones (so a Remarks column that
// happens to start with "c:" is left alone).
const ID_LIKE_KEY_RE = /(^id$|_id$|^phone|phone_number)/i;
const ID_PREFIX_RE = /^(l|p|ag|c|f|as):/i;

function cleanRecord(record) {
  const cleaned = {};
  for (const [key, value] of Object.entries(record)) {
    cleaned[key] = typeof value === "string" && ID_LIKE_KEY_RE.test(key) ? value.replace(ID_PREFIX_RE, "").trim() : value;
  }
  return cleaned;
}

// Phone is also used for click-to-call/WhatsApp links and as a dedupe key,
// so on top of the prefix strip above it's reduced to digits only — some
// tabs already store "919121011322", others "p:+91 9121 011322".
function normalizePhoneDigits(value) {
  if (!value) return "";
  return value.toString().replace(/[^\d]/g, "");
}

// Meta's "test lead" feature fills every question field with a placeholder
// like "<test lead: dummy data for full_name>" and always uses the same
// email — these aren't real leads and shouldn't reach the dashboard.
function isTestLead(record) {
  return Object.values(record).some(
    (v) => typeof v === "string" && /test lead:\s*dummy data/i.test(v)
  );
}

// Each company has its own Google Sheet config. A brand-new company gets a
// blank Settings doc seeded on first access — no env-var fallback here (that
// was only ever meaningful for the original single-tenant setup); a new
// company's admin fills in their own sheet ID via the Settings page.
async function getSettings(companyId) {
  await connectDB();
  let settings = await Settings.findOne({ companyId });
  if (!settings) {
    settings = await Settings.create({ companyId, sheets: [], syncIntervalMinutes: 1 });
  }
  return settings;
}

// Resolves the Settings' sheetName field into a concrete list of tabs to
// sync: blank/unset means every tab in the spreadsheet; otherwise a
// comma-separated allowlist of tab names.
async function resolveTabs(sheetId, sheetName) {
  if (sheetName && sheetName.trim()) {
    return sheetName
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return listSheetTabs(sheetId);
}

// Pulls every row from one company's configured sheet and upserts leads into
// MongoDB, writing a SyncLog entry every run, all scoped to that company —
// see /api/cron/sync.js for the loop that calls this once per active company.
// The dashboard picks up changes by polling /api/sync-status and /api/leads
// rather than a push.
//
// Duplicate-detection rules (customer = phone and/or email match, within the
// same company):
//   - Same raw sheet row seen again (model+rowNumber already ingested,
//     either as a lead's primary row or folded into someone's
//     enquiryHistory) -> re-sync is idempotent, update in place or skip.
//   - New row, same customer + same canonicalModel as an existing lead ->
//     repeat enquiry: folded into that lead's enquiryHistory/duplicateCount,
//     no new Lead document, assignedTo left untouched.
//   - New row, same customer but a DIFFERENT canonicalModel (or a brand-new
//     customer) -> a new Lead document, normal auto-assignment applies.
async function runSync(companyId) {
  await connectDB();
  const settings = await getSettings(companyId);
  const startedAt = new Date();

  if (!settings.sheets || settings.sheets.length === 0) {
    const log = await SyncLog.create({
      companyId,
      startedAt,
      finishedAt: new Date(),
      status: "error",
      errorMessage: "No Google Sheet configured. Add one on the Companies page.",
    });
    return log;
  }

  try {
    const assignNext = await createAgentAssigner(companyId);

    let totalRows = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;

    // Each linked sheet is synced in full, one after another — tab names
    // are expected to be unique across a company's sheets (see the
    // SheetSourceSchema note in models/Settings.js), since idempotency
    // below keys off (companyId, tab name, rowNumber), not sheetId.
    for (const sheetSource of settings.sheets) {
      const tabs = await resolveTabs(sheetSource.sheetId, sheetSource.sheetName);

      for (const tab of tabs) {
        const { records } = await fetchSheetRows(sheetSource.sheetId, tab);
        totalRows += records.length;

        const canonicalModel = canonicalModelFor(tab);

        for (const { rowNumber, record: rawRecord } of records) {
          if (isTestLead(rawRecord)) {
            skippedCount++;
            continue;
          }

          const record = cleanRecord(rawRecord);
          const leadId = findField(record, [/^lead\s*id$/i, /^id$/i]);
          const phone = normalizePhoneDigits(findField(record, [/phone/i, /mobile/i, /contact/i]));
          const name = findField(record, [/^name$/i, /full[_\s]*name/i, /customer/i]);
          const email = findField(record, [/email/i]);

          if (!leadId && !phone) {
            skippedCount++;
            continue; // nothing to dedupe this row on, skip it
          }

          const contentHash = hashRecord(record);
          const sheetCreatedAt = parseSheetDate(findField(record, FIELD_MATCHERS.createdTime));
          const location = normalizeShowroom(findField(record, FIELD_MATCHERS.showroom));

          // Step 1: has this exact sheet row already been ingested before,
          // either as a lead's primary row or folded into someone's history?
          // This is what makes re-running sync idempotent.
          const existing = await Lead.findOne({ companyId, model: tab, rowNumber });
          if (existing) {
            if (existing.contentHash !== contentHash) {
              existing.name = name;
              existing.email = email;
              existing.phone = phone || existing.phone;
              existing.canonicalModel = canonicalModel;
              existing.data = record;
              existing.contentHash = contentHash;
              existing.sheetCreatedAt = sheetCreatedAt || existing.sheetCreatedAt;
              existing.location = location || existing.location;
              await existing.save();
              updatedCount++;
            } else {
              unchangedCount++;
            }
            continue;
          }
          const alreadyRecordedElsewhere = await Lead.exists({
            companyId,
            "enquiryHistory.model": tab,
            "enquiryHistory.rowNumber": rowNumber,
          });
          if (alreadyRecordedElsewhere) {
            unchangedCount++;
            continue;
          }

          // Step 2/3: same dedup + create-or-fold logic used by the public
          // lead-ingestion API (Rule 1: repeat enquiry for the same customer +
          // model folds in; anything else becomes a new lead — see
          // lib/leadIngest.js).
          const { status } = await dedupeAndCreateLead({
            companyId,
            leadId,
            phone,
            email,
            name,
            model: tab,
            canonicalModel,
            data: record,
            source: "Google Sheet",
            sheetCreatedAt,
            location,
            rowNumber,
            contentHash,
            assignNext,
          });
          if (status === "duplicate") duplicateCount++;
          else newCount++;
        }
      }
    }

    const log = await SyncLog.create({
      companyId,
      startedAt,
      finishedAt: new Date(),
      status: "success",
      totalRows,
      newCount,
      updatedCount,
      unchangedCount,
      skippedCount,
      duplicateCount,
    });

    return log;
  } catch (err) {
    const log = await SyncLog.create({
      companyId,
      startedAt,
      finishedAt: new Date(),
      status: "error",
      errorMessage: err.message,
    });
    return log;
  }
}

async function buildStatusPayload(latestLog, companyId) {
  const settings = await getSettings(companyId);
  const totalRecords = await Lead.countDocuments({ companyId });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  // The sheet's own create_time, not our DB insert time — see the matching
  // fix/comment in pages/api/stats.js.
  const newLeadsToday = await Lead.countDocuments({ companyId, sheetCreatedAt: { $gte: startOfToday } });

  // A single transient error (e.g. a brief credentials hiccup) shouldn't flip
  // the indicator to Offline if a sync has actually succeeded recently — so
  // "online" is based on the most recent SUCCESSFUL sync, not just the very
  // latest log entry (which is only used for surfacing error details).
  const latestSuccess = await SyncLog.findOne({ companyId, status: "success" }).sort({ createdAt: -1 });
  const lastSyncTime = latestLog.finishedAt || latestLog.startedAt;
  const thresholdMs = Math.max(settings.syncIntervalMinutes * 3, 60 * 24) * 60 * 1000;
  const online =
    !!latestSuccess &&
    Date.now() - new Date(latestSuccess.finishedAt || latestSuccess.startedAt).getTime() < thresholdMs;

  return {
    lastSyncTime,
    online,
    lastRunStatus: latestLog.status,
    errorMessage: latestLog.errorMessage || null,
    totalRecords,
    newLeadsToday,
    lastSyncCounts: {
      totalRows: latestLog.totalRows,
      newCount: latestLog.newCount,
      updatedCount: latestLog.updatedCount,
      unchangedCount: latestLog.unchangedCount,
      skippedCount: latestLog.skippedCount,
      duplicateCount: latestLog.duplicateCount,
    },
  };
}

module.exports = { runSync, getSettings, buildStatusPayload, createAgentAssigner, normalizePhoneDigits };
