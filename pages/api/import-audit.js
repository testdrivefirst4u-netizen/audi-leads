const connectDB = require("../../lib/db");
const SyncLog = require("../../models/SyncLog");
const { requireSuperAdminForCompany } = require("../../lib/auth");
const { auditTab, listAuditTabs } = require("../../lib/importAudit");
const { runSync } = require("../../lib/syncService");
const { invalidate } = require("../../lib/serverCache");

// Import Audit, driven tab by tab by the page so no single request has to
// read a whole 36-tab spreadsheet (which takes ~25 s, longer than a
// serverless function is allowed):
//   GET  ?mode=tabs                       -> { tabs: [{sheetId, sheetLabel, tab}], lastSync }
//   GET  ?mode=tab&sheetId=...&tab=...    -> { tab: summary, rows, duplicates }
//   POST                                  -> run the sync now (idempotent)
// The page assembles totals and the Excel export itself.
async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;

  if (req.method === "POST") {
    const log = await runSync(companyId);
    invalidate(`leads-meta:${companyId}`);
    return res.status(200).json({ log });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (req.query.mode === "tab") {
      const { sheetId, tab } = req.query;
      if (!sheetId || !tab) return res.status(400).json({ error: "sheetId and tab are required" });
      const { settings } = await listAuditTabs(companyId);
      const sheetSource = (settings.sheets || []).find((s) => s.sheetId === String(sheetId));
      if (!sheetSource) return res.status(404).json({ error: "That spreadsheet is not connected to this company" });
      const result = await auditTab(companyId, settings, sheetSource, String(tab));
      return res.status(200).json(result);
    }

    // mode=tabs (default)
    const { settings, tabs } = await listAuditTabs(companyId);
    const lastSync = await SyncLog.findOne({ companyId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      tabs,
      error: !settings.sheets?.length ? "No Google Sheet configured for this company." : undefined,
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
  } catch (err) {
    console.error("[import-audit] failed:", err);
    return res.status(502).json({ error: `Could not read the Google Sheet: ${err.message}` });
  }
}

export default requireSuperAdminForCompany(handler);
