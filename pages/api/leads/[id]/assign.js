const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireAdmin } = require("../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { agentId } = req.body || {};

  await connectDB();
  const lead = await Lead.findByIdAndUpdate(
    id,
    { assignedTo: agentId || null },
    { new: true }
  ).populate("assignedTo", "name");
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead });
}

export default requireAdmin(handler);
