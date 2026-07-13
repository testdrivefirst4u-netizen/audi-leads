const connectDB = require("../../lib/db");
const SyncLog = require("../../models/SyncLog");
const { buildStatusPayload } = require("../../lib/syncService");
const { requireAdmin } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const latestLog = await SyncLog.findOne().sort({ createdAt: -1 });

  if (!latestLog) {
    return res.status(200).json({
      lastSyncTime: null,
      online: false,
      lastRunStatus: null,
      errorMessage: null,
      totalRecords: 0,
      newLeadsToday: 0,
      lastSyncCounts: null,
    });
  }

  const payload = await buildStatusPayload(latestLog);
  res.status(200).json(payload);
}

export default requireAdmin(handler);
