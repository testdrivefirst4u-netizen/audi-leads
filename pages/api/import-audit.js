const XLSX = require("xlsx");
const connectDB = require("../../lib/db");
const SyncLog = require("../../models/SyncLog");
const { requireCompanyMemberOrSuperAdmin } = require("../../lib/auth");
const { auditCompanyImport } = require("../../lib/importAudit");
const { runSync } = require("../../lib/syncService");
const { withCache, invalidate } = require("../../lib/serverCache");

// Reading every configured sheet tab from Google is the slow part — cache
// the finished audit briefly so opening the page, switching filters, and
// downloading the Excel don't each re-pull the sheets; "Re-check now"
// (?refresh=1) and a manual sync both invalidate it.
const AUDIT_CACHE_MS = 5 * 60 * 1000;

const STATUS_LABELS = {
  imported: "Imported",
  merged: "Merged (repeat enquiry)",
  skipped: "Skipped",
  missing: "Missing",
  mismatch: "Mismatch",
};

function toWorkbook(audit) {
  const header = ["Status", "Sheet", "Tab", "Sheet Row", "Name", "Phone", "Email", "Created Time", "CRM Lead", "Details"];
  const rows = audit.rows.map((r) => [
    STATUS_LABELS[r.status] || r.status,
    r.sheetLabel,
    r.tab,
    r.sheetRow,
    r.name,
    r.phone,
    r.email,
    r.createdTime,
    r.leadName || "",
    r.reason || "",
  ]);
  const summary = [
    ["Tab", "Sheet rows", "Imported", "Merged", "Skipped", "Missing", "Mismatch", "Leads in CRM", "Duplicate records", "Orphaned leads"],
    ...audit.tabs.map((t) => [t.tab, t.totalRows, t.imported, t.merged, t.skipped, t.missing, t.mismatch, t.leadsInCrm, t.duplicateLeads, t.orphaned]),
    ["TOTAL", ...["totalRows", "imported", "merged", "skipped", "missing", "mismatch", "leadsInCrm", "duplicateLeads", "orphaned"].map((k) => audit.totals[k])],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...rows]), "All Rows");
  const problems = audit.rows.filter((r) => r.status !== "imported" && r.status !== "merged");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([header, ...rows.filter((_, i) => audit.rows[i].status !== "imported" && audit.rows[i].status !== "merged")]),
    `Needs Attention (${problems.length})`
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Tab", "Sheet Row", "Name", "Phone", "Lead records", "Lead IDs"],
      ...(audit.duplicates || []).map((d) => [d.tab, d.sheetRow, d.name, d.phone, d.count, d.leadIds.join(", ")]),
    ]),
    `Duplicate Records (${(audit.duplicates || []).length})`
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function handler(req, res) {
  // Agents only ever see their own assigned leads — a whole-sheet audit is
  // an admin's view of the import pipeline, not theirs.
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });

  await connectDB();
  const companyId = req.session.companyId;
  const cacheKey = `import-audit:${companyId}`;

  if (req.method === "POST") {
    // "Sync now" — the sync is idempotent, so this is the safe fix for
    // rows the audit reports as missing.
    const log = await runSync(companyId);
    invalidate(cacheKey);
    return res.status(200).json({ log });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (req.query.refresh === "1") invalidate(cacheKey);
  let audit;
  try {
    audit = await withCache(cacheKey, AUDIT_CACHE_MS, () => auditCompanyImport(companyId));
  } catch (err) {
    console.error("[import-audit] failed:", err);
    return res.status(502).json({ error: `Could not read the Google Sheet: ${err.message}` });
  }

  if (req.query.format === "xlsx") {
    const buffer = toWorkbook(audit);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="import-audit-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.status(200).send(buffer);
  }

  const lastSync = await SyncLog.findOne({ companyId }).sort({ createdAt: -1 }).lean();
  res.status(200).json({
    ...audit,
    lastSync: lastSync
      ? {
          at: lastSync.finishedAt || lastSync.startedAt,
          status: lastSync.status,
          errorMessage: lastSync.errorMessage || "",
          counts: {
            totalRows: lastSync.totalRows,
            newCount: lastSync.newCount,
            updatedCount: lastSync.updatedCount,
            skippedCount: lastSync.skippedCount,
            duplicateCount: lastSync.duplicateCount,
          },
        }
      : null,
  });
}

export default requireCompanyMemberOrSuperAdmin(handler);
