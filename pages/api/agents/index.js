const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const { hashPassword, requireAdmin } = require("../../../lib/auth");

async function handler(req, res) {
  await connectDB();

  if (req.method === "GET") {
    const agents = await Agent.find({}).sort({ createdAt: 1 }).lean();
    const perf = await Lead.aggregate([
      { $match: { assignedTo: { $ne: null } } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ["$status", "Won"] }, 1, 0] } },
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
    const { name, username, password } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ error: "Name, username, and password are required" });
    }

    const existing = await Agent.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: "That username is already taken" });
    }

    const passwordHash = await hashPassword(password);
    const agent = await Agent.create({ name, username, passwordHash, active: true });
    return res.status(201).json({ agent: { _id: agent._id, name: agent.name, username: agent.username, active: true } });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireAdmin(handler);
