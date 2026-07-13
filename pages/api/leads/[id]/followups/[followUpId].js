const connectDB = require("../../../../../lib/db");
const Lead = require("../../../../../models/Lead");
const { requireAuth } = require("../../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../../lib/leadAccess");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id, followUpId } = req.query;
  const { completed } = req.body || {};

  await connectDB();
  const lead = await Lead.findOne({ ...leadOwnershipFilter(req.session, id), "followUps._id": followUpId });
  if (!lead) return res.status(404).json({ error: "Follow-up not found" });

  const followUp = lead.followUps.id(followUpId);
  followUp.completed = Boolean(completed);
  followUp.completedAt = followUp.completed ? new Date() : undefined;
  await lead.save();

  res.status(200).json({ lead });
}

export default requireAuth(handler);
