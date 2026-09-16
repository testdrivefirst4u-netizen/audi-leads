const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getAuth() {
  const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;

  if (keyFilePath && fs.existsSync(keyFilePath)) {
    return new google.auth.GoogleAuth({ keyFile: keyFilePath, scopes: SCOPES });
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service account credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY."
    );
  }

  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: SCOPES,
  });
}

// The Sheets API allows 60 read requests per minute per user, shared by
// every company's sync (one request per tab per run) plus anything else
// reading sheets at the same moment (the Import Audit page). Hitting the
// cap throws a 429 — and until this, that single throw aborted the whole
// sync run for that company, so every tab after the one that tripped it
// was silently not imported until the next run. A brief wait almost always
// clears it (the window is per minute), so retry instead of failing.
const QUOTA_RETRY_DELAYS_MS = [15000, 30000, 45000];

function isQuotaError(err) {
  return err?.code === 429 || err?.response?.status === 429 || /quota exceeded/i.test(err?.message || "");
}

async function withQuotaRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isQuotaError(err) || attempt >= QUOTA_RETRY_DELAYS_MS.length) throw err;
      const delay = QUOTA_RETRY_DELAYS_MS[attempt];
      console.warn(`[sheets] read quota exceeded — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${QUOTA_RETRY_DELAYS_MS.length})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// A spreadsheet's tab list changes rarely but is re-fetched on every sync
// run — one quota-counted request per company per run for an answer that
// is nearly always the same. Cached briefly per spreadsheet.
const TAB_LIST_CACHE_MS = 10 * 60 * 1000;
const tabListCache = new Map(); // sheetId -> { tabs, fetchedAt }

// Lists every tab (sheet) in the spreadsheet by title.
async function listSheetTabs(sheetId) {
  const cached = tabListCache.get(sheetId);
  if (cached && Date.now() - cached.fetchedAt < TAB_LIST_CACHE_MS) return cached.tabs;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await withQuotaRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "sheets.properties.title",
    })
  );
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title);
  tabListCache.set(sheetId, { tabs, fetchedAt: Date.now() });
  return tabs;
}

// A1 notation requires sheet names to be single-quoted whenever they could be
// mistaken for a cell reference (e.g. tab "A6" or "Q3" collide with column+row
// addresses) or contain spaces/special characters. Quoting unconditionally is
// always safe.
function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

// Fetches every row of the given sheet tab and pairs it with the header row,
// returning plain objects keyed by column header plus the sheet row number.
async function fetchSheetRows(sheetId, sheetName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await withQuotaRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: quoteSheetName(sheetName),
    })
  );

  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], records: [] };

  const [headers, ...dataRows] = rows;
  const records = dataRows
    .map((row, idx) => {
      const record = {};
      headers.forEach((h, i) => {
        record[String(h).trim()] = (row[i] ?? "").toString().trim();
      });
      return { rowNumber: idx + 1, record };
    })
    // skip fully blank rows
    .filter(({ record }) => Object.values(record).some((v) => v !== ""));

  return { headers, records };
}

module.exports = { fetchSheetRows, listSheetTabs };
