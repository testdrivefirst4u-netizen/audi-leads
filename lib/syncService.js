const crypto = require("crypto");
const connectDB = require("./db");
const Lead = require("../models/Lead");
const SyncLog = require("../models/SyncLog");
const Settings = require("../models/Settings");
const { fetchSheetRows, listSheetTabs } = require("./googleSheets");

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

// Pulls every row from the configured sheet, upserts new/changed leads into
// MongoDB (deduped by Lead ID, falling back to Phone), writes a SyncLog, and
// pushes live updates over the given Socket.IO server.
async function runSync(io) {
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
    if (io) io.emit("sync:status", await buildStatusPayload(log));
    return log;
  }

  try {
    const tabs = await resolveTabs(settings.sheetId, settings.sheetName);

    let totalRows = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let hasChanges = false;

    for (const tab of tabs) {
      const { records } = await fetchSheetRows(settings.sheetId, tab);
      totalRows += records.length;

      for (const { rowNumber, record } of records) {
        const leadId = findField(record, [/^lead\s*id$/i, /^id$/i]);
        const phone = findField(record, [/phone/i, /mobile/i, /contact/i]);
        const name = findField(record, [/^name$/i, /full[_\s]*name/i, /customer/i]);
        const email = findField(record, [/email/i]);

        if (!leadId && !phone) continue; // nothing to dedupe this row on, skip it

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
            data: record,
            rowNumber,
            contentHash,
          });
          newCount++;
          hasChanges = true;
        } else if (existing.contentHash !== contentHash) {
          existing.name = name;
          existing.email = email;
          existing.phone = phone || existing.phone;
          existing.data = record;
          existing.rowNumber = rowNumber;
          existing.contentHash = contentHash;
          await existing.save();
          updatedCount++;
          hasChanges = true;
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
    });

    if (io) {
      io.emit("sync:status", await buildStatusPayload(log));
      if (hasChanges) io.emit("leads:changed", { newCount, updatedCount });
    }

    return log;
  } catch (err) {
    const log = await SyncLog.create({
      startedAt,
      finishedAt: new Date(),
      status: "error",
      errorMessage: err.message,
    });
    if (io) io.emit("sync:status", await buildStatusPayload(log));
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
    },
  };
}

module.exports = { runSync, getSettings, buildStatusPayload };
