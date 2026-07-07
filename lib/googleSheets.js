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

// Lists every tab (sheet) in the spreadsheet by title.
async function listSheetTabs(sheetId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  return (meta.data.sheets || []).map((s) => s.properties.title);
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

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: quoteSheetName(sheetName),
  });

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
