const connectDB = require("../../lib/db");
const SyncLog = require("../../models/SyncLog");
const { requireAdmin } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const logs = await SyncLog.find().sort({ createdAt: -1 }).limit(20).lean();
  res.status(200).json({ logs });
}

export default requireAdmin(handler);
