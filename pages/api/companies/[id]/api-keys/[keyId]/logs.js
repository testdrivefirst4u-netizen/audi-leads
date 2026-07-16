const connectDB = require("../../../../../../lib/db");
const ApiKeyLog = require("../../../../../../models/ApiKeyLog");
const { requireSuperAdmin } = require("../../../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId, keyId } = req.query;

  const logs = await ApiKeyLog.find({ companyId, apiKeyId: keyId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.status(200).json({ logs });
}

export default requireSuperAdmin(handler);
