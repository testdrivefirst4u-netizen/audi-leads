// Minimal, dependency-free CSV builder. Excel opens CSV natively, and this
// avoids pulling in a spreadsheet library (the popular ones for .xlsx either
// have unpatched advisories or are heavier than this needs).
function escapeCell(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

module.exports = { toCsv };
