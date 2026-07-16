const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const Agent = require("../../../../models/Agent");
const { requireAdmin } = require("../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { agentId } = req.body || {};
  const { companyId } = req.session;

  await connectDB();

  // Guard against reassigning to an agent from a different company (e.g. a
  // guessed ID) — only agents within this same company are valid targets.
  if (agentId) {
    const agentBelongsToCompany = await Agent.exists({ _id: agentId, companyId });
    if (!agentBelongsToCompany) return res.status(400).json({ error: "Invalid agent" });
  }

  const lead = await Lead.findOneAndUpdate(
    { _id: id, companyId },
    { assignedTo: agentId || null },
    { new: true }
  ).populate("assignedTo", "name");
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead });
}

export default requireAdmin(handler);
