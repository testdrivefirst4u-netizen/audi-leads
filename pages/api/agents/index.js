const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH, requireCompanyMemberOrSuperAdminView } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");

async function handler(req, res) {
  await connectDB();

  const { companyId } = req.session;

  if (req.method === "GET") {
    const agents = await Agent.find({ companyId }).sort({ createdAt: 1 }).lean();
    const perf = await Lead.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId), assignedTo: { $ne: null } } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ["$status", "Retail (Converted)"] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ["$status", "Lost"] }, 1, 0] } },
          contacted: { $sum: { $cond: [{ $ne: ["$status", "New"] }, 1, 0] } },
          calls: { $sum: { $size: "$calls" } },
        },
      },
    ]);
    const perfMap = Object.fromEntries(perf.map((p) => [String(p._id), p]));

    return res.status(200).json({
      agents: agents.map((a) => {
        const p = perfMap[String(a._id)];
        const total = p?.total || 0;
        const won = p?.won || 0;
        return {
          _id: a._id,
          name: a.name,
          username: a.username,
          active: a.active,
          location: a.location || "",
          createdAt: a.createdAt,
          leadCount: total,
          contacted: p?.contacted || 0,
          won,
          lost: p?.lost || 0,
          calls: p?.calls || 0,
          winRate: total > 0 ? Math.round((won / total) * 100) : 0,
        };
      }),
    });
  }

  if (req.method === "POST") {
    // Creating an agent is a super-admin-only action — a company's own
    // admin can no longer add agents themselves, only view/manage the ones
    // the super admin has created for them (see pages/api/agents/[id].js,
    // still requireAdmin, for that day-to-day management).
    if (req.session.role !== "super_admin") {
      return res.status(403).json({ error: "Only the platform super admin can add new agents" });
    }
    const { name, username, password, location = "" } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ error: "Name, username, and password are required" });
    }
    if (!isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const existing = await Agent.findOne({ username }).lean();
    if (existing) {
      return res.status(409).json({ error: "That username is already taken" });
    }

    const passwordHash = await hashPassword(password);
    const agent = await Agent.create({ name, username, passwordHash, active: true, location, companyId });
    // /api/leads.js caches the active-agent list for its reassign dropdown —
    // a newly-created agent should be selectable right away, not after the cache expires.
    invalidate(`leads-agents:${companyId}`);
    return res.status(201).json({
      agent: { _id: agent._id, name: agent.name, username: agent.username, active: true, location: agent.location },
    });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdminView(handler);
