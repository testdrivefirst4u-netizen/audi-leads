const ExcelJS = require("exceljs");
const { requireCompanyMemberOrSuperAdminView } = require("../../../lib/auth");

export const config = {
  api: {
    bodyParser: { sizeLimit: "20mb" },
  },
};

function addImageIfPresent(workbook, worksheet, dataUrl, anchor) {
  if (!dataUrl) return;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return;
  const extension = match[1] === "jpg" ? "jpeg" : match[1];
  const imageId = workbook.addImage({ base64: match[2], extension });
  worksheet.addImage(imageId, anchor);
}

// One sheet's worth of a report: title/date-range/filters header, a
// Category|Count|Percentage table with a total row, and the two chart
// images anchored below it. Shared by both the single-report export and the
// "download all reports" multi-sheet export so the two stay in sync.
function buildReportSheet(workbook, sheetName, { reportTitle, dateRange, filtersApplied, rows, valueLabel, barImage, pieImage }) {
  const total = rows.reduce((sum, r) => sum + (r.count || 0), 0);

  const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 4 }, { width: 14 }, { width: 14 }, { width: 4 }];

  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = reportTitle;
  sheet.getCell("A1").font = { size: 16, bold: true };

  sheet.getCell("A2").value = "Date Range";
  sheet.getCell("A2").font = { bold: true };
  sheet.getCell("B2").value = dateRange.from && dateRange.to ? `${dateRange.from} to ${dateRange.to}` : "All time";

  sheet.getCell("A3").value = "Filters Applied";
  sheet.getCell("A3").font = { bold: true };
  const filterEntries = Object.entries(filtersApplied || {});
  sheet.getCell("B3").value = filterEntries.length ? filterEntries.map(([k, v]) => `${k}: ${v}`).join(", ") : "None";

  sheet.getCell("A4").value = "Generated At";
  sheet.getCell("A4").font = { bold: true };
  sheet.getCell("B4").value = new Date().toLocaleString();

  const headerRowIndex = 6;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = ["Category", valueLabel, "Percentage"];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F5F9" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE5E8F0" } } };
  });

  rows.forEach((row, i) => {
    const r = sheet.getRow(headerRowIndex + 1 + i);
    r.values = [row.label, row.count, `${row.percentage}%`];
  });

  const totalRowIndex = headerRowIndex + 1 + rows.length;
  const totalRow = sheet.getRow(totalRowIndex);
  totalRow.values = ["Total", total, "100%"];
  totalRow.font = { bold: true };

  const chartsHeaderRowIndex = totalRowIndex + 2;
  sheet.getCell(`A${chartsHeaderRowIndex}`).value = "Charts";
  sheet.getCell(`A${chartsHeaderRowIndex}`).font = { size: 13, bold: true };

  const imageRowIndex = chartsHeaderRowIndex + 1;
  addImageIfPresent(workbook, sheet, barImage, {
    tl: { col: 0, row: imageRowIndex },
    ext: { width: 380, height: 190 },
  });
  addImageIfPresent(workbook, sheet, pieImage, {
    tl: { col: 5, row: imageRowIndex },
    ext: { width: 320, height: 220 },
  });
}

// Excel worksheet names: <=31 chars, and none of []:*?/\
function safeSheetName(title, index) {
  const cleaned = title.replace(/[[\]:*?/\\]/g, "").slice(0, 31);
  return cleaned || `Report ${index + 1}`;
}

function safeFilenamePart(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { dateRange = {}, filtersApplied = {}, reports, reportTitle, rows, valueLabel, barImage, pieImage } = req.body || {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Leads Dashboard";
  workbook.created = new Date();

  let filename;

  if (Array.isArray(reports) && reports.length > 0) {
    // "Download all reports" — one worksheet per report type, same layout as
    // a single-report export.
    const usedNames = new Set();
    reports.forEach((report, i) => {
      let name = safeSheetName(report.reportTitle || `Report ${i + 1}`, i);
      while (usedNames.has(name)) name = `${name.slice(0, 28)} (${i})`;
      usedNames.add(name);
      buildReportSheet(workbook, name, {
        reportTitle: report.reportTitle || `Report ${i + 1}`,
        dateRange,
        filtersApplied,
        rows: report.rows || [],
        valueLabel: report.valueLabel || "Leads",
        barImage: report.barImage,
        pieImage: report.pieImage,
      });
    });
    filename = `all-reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
  } else {
    buildReportSheet(workbook, "Report", {
      reportTitle: reportTitle || "Lead Report",
      dateRange,
      filtersApplied,
      rows: rows || [],
      valueLabel: valueLabel || "Leads",
      barImage,
      pieImage,
    });
    filename = `${safeFilenamePart(reportTitle || "report") || "report"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(Buffer.from(buffer));
}

export default requireCompanyMemberOrSuperAdminView(handler);
