/**
 * Broadcast CRM — instant push of new Google Sheet rows.
 *
 * Install once per lead sheet (Extensions → Apps Script → paste → save →
 * run `setupTriggers` once and approve the permissions). From then on,
 * every row that lands in any tab is POSTed to the CRM within seconds
 * (on change, plus a 1-minute safety sweep), and the CRM turns it into a
 * lead through exactly the same pipeline as the scheduled sync — so the
 * daily full sync later sees these rows as already imported.
 *
 * Setup:
 *   1. CRM → Companies → this company → API Keys → generate a key with
 *      source name "Google Sheets" (any name works) → paste it below.
 *   2. Leave CRM_URL as the deployed CRM.
 *   3. Run setupTriggers() once.
 *
 * Only rows added AFTER installation are pushed (the first run records
 * the current row count of every tab as "already imported"); history is
 * covered by the CRM's regular sync. To re-baseline after bulk edits, run
 * markAllAsPushed().
 */

const CRM_URL = "https://sales.broaddcast.com/api/public/sheet-rows";
const API_KEY = "PASTE_YOUR_LEAD_SOURCE_API_KEY_HERE";
const CHUNK = 200;

function pushNewRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getDocumentProperties();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return; // another run is in progress
  try {
    ss.getSheets().forEach(function (sheet) {
      const tab = sheet.getName();
      const key = "lastPushed:" + sheet.getSheetId();
      const lastRow = sheet.getLastRow();
      const lastPushed = Number(props.getProperty(key) || 0);

      if (!props.getProperty(key)) {
        // First time we see this tab: baseline, don't re-send history.
        props.setProperty(key, String(lastRow));
        return;
      }
      if (lastRow <= lastPushed || lastRow < 2) return;

      const lastCol = sheet.getLastColumn();
      const headers = sheet
        .getRange(1, 1, 1, lastCol)
        .getDisplayValues()[0]
        .map(function (h) {
          return String(h).trim();
        });
      const values = sheet.getRange(lastPushed + 1, 1, lastRow - lastPushed, lastCol).getDisplayValues();

      const rows = [];
      values.forEach(function (vals, i) {
        const record = {};
        headers.forEach(function (h, c) {
          if (h) record[h] = vals[c];
        });
        const nonEmpty = Object.keys(record).some(function (k) {
          return record[k] !== "";
        });
        // rowNumber = sheet row - 1 (row 1 is the header) — the CRM's numbering.
        if (nonEmpty) rows.push({ rowNumber: lastPushed + i, record: record });
      });

      let ok = true;
      for (let i = 0; i < rows.length && ok; i += CHUNK) {
        ok = postRows(ss.getId(), tab, rows.slice(i, i + CHUNK));
      }
      // Only advance the marker if every chunk was accepted, so a failed
      // push is retried on the next run instead of being skipped.
      if (ok) props.setProperty(key, String(lastRow));
    });
  } finally {
    lock.releaseLock();
  }
}

function postRows(sheetId, tab, rows) {
  const res = UrlFetchApp.fetch(CRM_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + API_KEY },
    payload: JSON.stringify({ sheetId: sheetId, tab: tab, rows: rows }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    console.log("Pushed " + rows.length + " row(s) from '" + tab + "': " + res.getContentText());
    return true;
  }
  console.error("CRM rejected rows from '" + tab + "' (HTTP " + code + "): " + res.getContentText());
  return false;
}

/** Run once after pasting the script. */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pushNewRows") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pushNewRows").forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  ScriptApp.newTrigger("pushNewRows").timeBased().everyMinutes(1).create();
  pushNewRows(); // baseline every tab now
  console.log("Triggers installed: on change + every minute.");
}

/** Treat everything currently in the sheet as already imported. */
function markAllAsPushed() {
  const props = PropertiesService.getDocumentProperties();
  SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .forEach(function (sheet) {
      props.setProperty("lastPushed:" + sheet.getSheetId(), String(sheet.getLastRow()));
    });
}
