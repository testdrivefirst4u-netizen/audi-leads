const crypto = require("crypto");
const connectDB = require("./db");
const Lead = require("../models/Lead");
const SyncLog = require("../models/SyncLog");
const Settings = require("../models/Settings");
const { fetchSheetRows, listSheetTabs } = require("./googleSheets");
const { canonicalModelFor } = require("./leadFields");

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

async function getSettings() {
  await connectDB();
  let settings = await Settings.findOne({ key: "default" });
  if (!settings) {
    settings = await Settings.create({
      key: "default",
      sheetId: process.env.GOOGLE_SHEET_ID || "",
      // Blank means "sync every tab in the spreadsheet". Comma-separate tab
      // names here to restrict to a subset instead.
      sheetName: process.env.GOOGLE_SHEET_NAME || "",
      syncIntervalMinutes: [1, 5, 15].includes(Number(process.env.SYNC_INTERVAL_MINUTES))
        ? Number(process.env.SYNC_INTERVAL_MINUTES)
        : 1,
    });
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

// Pulls every row from the configured sheet and upserts new/changed leads
// into MongoDB (deduped by Lead ID, falling back to Phone), writing a
// SyncLog entry every run. Called from /api/cron/sync (any external
// scheduler) and from the Settings save handler. The dashboard picks up
// changes by polling /api/sync-status and /api/leads rather than a push.
async function runSync() {
  await connectDB();
  const settings = await getSettings();
  const startedAt = new Date();

  if (!settings.sheetId) {
    const log = await SyncLog.create({
      startedAt,
      finishedAt: new Date(),
      status: "error",
      errorMessage: "No Google Sheet ID configured. Set it on the Settings page.",
    });
    return log;
  }

  try {
    const tabs = await resolveTabs(settings.sheetId, settings.sheetName);

    let totalRows = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedCount = 0;

    for (const tab of tabs) {
      const { records } = await fetchSheetRows(settings.sheetId, tab);
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
        // Scope the dedupe key to this tab: the same phone/id combination in
        // two different model tabs represents two distinct lead submissions.
        const query = leadId ? { leadId, model: tab } : { phone, model: tab };
        const existing = await Lead.findOne(query);

        if (!existing) {
          await Lead.create({
            leadId: leadId || undefined,
            phone: phone || undefined,
            name,
            email,
            model: tab,
            canonicalModel,
            data: record,
            rowNumber,
            contentHash,
          });
          newCount++;
        } else if (existing.contentHash !== contentHash) {
          existing.name = name;
          existing.email = email;
          existing.phone = phone || existing.phone;
          existing.canonicalModel = canonicalModel;
          existing.data = record;
          existing.rowNumber = rowNumber;
          existing.contentHash = contentHash;
          await existing.save();
          updatedCount++;
        } else {
          unchangedCount++;
        }
      }
    }

    const log = await SyncLog.create({
      startedAt,
      finishedAt: new Date(),
      status: "success",
      totalRows,
      newCount,
      updatedCount,
      unchangedCount,
      skippedCount,
    });

    return log;
  } catch (err) {
    const log = await SyncLog.create({
      startedAt,
      finishedAt: new Date(),
      status: "error",
      errorMessage: err.message,
    });
    return log;
  }
}

async function buildStatusPayload(latestLog) {
  const settings = await getSettings();
  const totalRecords = await Lead.countDocuments();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const newLeadsToday = await Lead.countDocuments({ createdAt: { $gte: startOfToday } });

  const lastSyncTime = latestLog.finishedAt || latestLog.startedAt;
  const thresholdMs = settings.syncIntervalMinutes * 2 * 60 * 1000;
  const online = latestLog.status === "success" && Date.now() - new Date(lastSyncTime).getTime() < thresholdMs;

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
    },
  };
}

module.exports = { runSync, getSettings, buildStatusPayload };
