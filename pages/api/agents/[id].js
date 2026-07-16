const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const { hashPassword, requireAdmin } = require("../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id } = req.query;
  const { active, name, password, location } = req.body || {};

  const update = {};
  if (active !== undefined) update.active = Boolean(active);
  if (name !== undefined) update.name = String(name).trim();
  if (location !== undefined) update.location = String(location).trim();
  if (password) update.passwordHash = await hashPassword(password);

  const agent = await Agent.findOneAndUpdate({ _id: id, companyId: req.session.companyId }, update, { new: true });
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  res.status(200).json({
    agent: { _id: agent._id, name: agent.name, username: agent.username, active: agent.active, location: agent.location },
  });
}

export default requireAdmin(handler);
