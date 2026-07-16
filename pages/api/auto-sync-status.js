const connectDB = require("../../lib/db");
const SyncLog = require("../../models/SyncLog");
const Settings = require("../../models/Settings");
const { requireCompanyMember } = require("../../lib/auth");

// A deliberately minimal, non-admin-gated version of /api/sync-status — just
// enough for a small "Auto Sync Enabled / Last Synced Xs ago" badge that
// every company member (not just the admin) can see. The detailed counts,
// error messages, and sheet config stay behind requireAdmin on the full
// /api/sync-status and /api/settings endpoints.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { companyId } = req.session;

  const settings = await Settings.findOne({ companyId }).lean();
  const latestSuccess = await SyncLog.findOne({ companyId, status: "success" }).sort({ createdAt: -1 }).lean();

  if (!latestSuccess) {
    return res.status(200).json({ online: false, lastSyncTime: null });
  }

  const lastSyncTime = latestSuccess.finishedAt || latestSuccess.startedAt;
  const intervalMinutes = settings?.syncIntervalMinutes || 1440;
  const thresholdMs = Math.max(intervalMinutes * 3, 60 * 24) * 60 * 1000;
  const online = Date.now() - new Date(lastSyncTime).getTime() < thresholdMs;

  res.status(200).json({ online, lastSyncTime });
}

export default requireCompanyMember(handler);
