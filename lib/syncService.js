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
// A sync that's still "in progress" longer than this is assumed to have
// crashed without releasing its lock (a killed process, an unhandled
// rejection) rather than genuinely still running — long enough that no
// real sync of this app's data volumes should ever take this long.
const SYNC_LOCK_STALE_MS = 10 * 60 * 1000;

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

  // Two overlapping runs for the same company (e.g. the local dev scheduler
  // firing again before a long previous run finished) would each take their
  // own snapshot of "which rows already exist" and could both decide the
  // same sheet row is new — creating a duplicate Lead for it. This lock
  // makes sure only one runSync() is ever actually doing work per company
  // at a time; a second caller skips instead of racing.
  const lockAcquired = await Settings.findOneAndUpdate(
    {
      companyId,
      $or: [{ "syncLock.inProgress": { $ne: true } }, { "syncLock.startedAt": { $lt: new Date(Date.now() - SYNC_LOCK_STALE_MS) } }],
    },
    { $set: { "syncLock.inProgress": true, "syncLock.startedAt": startedAt } },
    { new: true }
  );
  if (!lockAcquired) {
    return SyncLog.create({
      companyId,
      startedAt,
      finishedAt: new Date(),
      status: "skipped",
      errorMessage: "A sync for this company was already in progress — skipped to avoid creating duplicate leads.",
    });
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

        // Pass 1 (no DB): parse every row and filter out test/unusable ones.
        // Nothing here depends on what's already in Mongo, so it's all done
        // upfront before the first query for this tab.
        const parsedRows = [];
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

          parsedRows.push({
            rowNumber,
            record,
            leadId,
            phone,
            name,
            email,
            contentHash: hashRecord(record),
            sheetCreatedAt: parseSheetDate(findField(record, FIELD_MATCHERS.createdTime)),
            location: normalizeShowroom(findField(record, FIELD_MATCHERS.showroom)),
          });
        }
        if (parsedRows.length === 0) continue;

        // Pass 2: figure out, for every row in this tab, whether it's
        // already ingested — in ONE round trip each instead of one (or two)
        // per row. On a steady-state run the overwhelming majority of rows
        // are already-ingested-and-unchanged (re-syncing the same sheet
        // every day), so this replaces what used to be up to ~2 sequential
        // queries PER ROW with exactly 2 queries PER TAB, run in parallel.
        const rowNumbers = parsedRows.map((r) => r.rowNumber);
        const [existingDocs, recordedElsewhereDocs] = await Promise.all([
          Lead.find({ companyId, model: tab, rowNumber: { $in: rowNumbers } })
            .select("rowNumber contentHash")
            .lean(),
          Lead.find({
            companyId,
            "enquiryHistory.model": tab,
            "enquiryHistory.rowNumber": { $in: rowNumbers },
          })
            .select("enquiryHistory")
            .lean(),
        ]);
        const existingByRow = new Map(existingDocs.map((d) => [d.rowNumber, d]));
        const recordedElsewhereRows = new Set();
        for (const doc of recordedElsewhereDocs) {
          for (const entry of doc.enquiryHistory) {
            if (entry.model === tab) recordedElsewhereRows.add(entry.rowNumber);
          }
        }

        // Pass 3: the actual mutations, still one row at a time and still in
        // original sheet order — dedupeAndCreateLead does its own live
        // phone/email lookup per call, so a repeat enquiry later in this
        // exact run still correctly folds into a lead created earlier in
        // it. Only the "do I already know about this row" answer moved
        // from a live query to the map/set built above; the decision logic
        // and mutations are byte-for-byte the same as before.
        for (const row of parsedRows) {
          const existing = existingByRow.get(row.rowNumber);
          if (existing) {
            if (existing.contentHash !== row.contentHash) {
              // A plain updateOne instead of fetch-mutate-.save(): same
              // fields, same fallback-to-existing-value semantics, but
              // skips hydrating a full Mongoose document for a change this
              // mechanical. Lead has no pre-save hooks these fields would
              // need to trigger.
              await Lead.updateOne(
                { _id: existing._id },
                {
                  $set: {
                    name: row.name,
                    email: row.email,
                    ...(row.phone ? { phone: row.phone } : {}),
                    canonicalModel,
                    data: row.record,
                    contentHash: row.contentHash,
                    ...(row.sheetCreatedAt ? { sheetCreatedAt: row.sheetCreatedAt } : {}),
                    ...(row.location ? { location: row.location } : {}),
                  },
                }
              );
              updatedCount++;
            } else {
              unchangedCount++;
            }
            continue;
          }

          if (recordedElsewhereRows.has(row.rowNumber)) {
            unchangedCount++;
            continue;
          }

          // Step 2/3: same dedup + create-or-fold logic used by the public
          // lead-ingestion API (Rule 1: repeat enquiry for the same customer +
          // model folds in; anything else becomes a new lead — see
          // lib/leadIngest.js).
          const { status } = await dedupeAndCreateLead({
            companyId,
            leadId: row.leadId,
            phone: row.phone,
            email: row.email,
            name: row.name,
            model: tab,
            canonicalModel,
            data: row.record,
            source: "Meta Ads",
            sheetCreatedAt: row.sheetCreatedAt,
            location: row.location,
            rowNumber: row.rowNumber,
            contentHash: row.contentHash,
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
  } finally {
    await Settings.updateOne({ companyId }, { $set: { "syncLock.inProgress": false, "syncLock.startedAt": null } });
  }
}

async function buildStatusPayload(latestLog, companyId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // These four are independent reads — running them concurrently instead of
  // one after another cuts this endpoint's wall-clock time roughly 4x
  // without changing anything about what's returned. `.lean()` on the
  // SyncLog lookup skips hydrating a full Mongoose document for what's only
  // ever read, never saved.
  const [settings, totalRecords, newLeadsToday, latestSuccess] = await Promise.all([
    getSettings(companyId),
    Lead.countDocuments({ companyId }),
    // The sheet's own create_time, not our DB insert time — see the matching
    // fix/comment in pages/api/stats.js.
    Lead.countDocuments({ companyId, sheetCreatedAt: { $gte: startOfToday } }),
    // A single transient error (e.g. a brief credentials hiccup) shouldn't
    // flip the indicator to Offline if a sync has actually succeeded
    // recently — so "online" is based on the most recent SUCCESSFUL sync,
    // not just the very latest log entry (which is only used for surfacing
    // error details).
    SyncLog.findOne({ companyId, status: "success" }).sort({ createdAt: -1 }).lean(),
  ]);
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
