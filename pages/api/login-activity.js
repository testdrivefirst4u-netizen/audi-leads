const mongoose = require("mongoose");
const connectDB = require("../../lib/db");
const LoginEvent = require("../../models/LoginEvent");
const Admin = require("../../models/Admin");
const Agent = require("../../models/Agent");
const Company = require("../../models/Company");
const { requireSuperAdmin } = require("../../lib/auth");

// Login Activity for the super admin: every login attempt across the
// platform, plus who is online right now (lastSeenAt within a few minutes).
//   GET ?companyId=&role=&status=all|success|failed&q=&page=&pageSize=
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();

  const { companyId = "", role = "", status = "all", q = "", page = "1", pageSize = "50" } = req.query;
  const filter = {};
  if (companyId && mongoose.isValidObjectId(companyId)) filter.companyId = new mongoose.Types.ObjectId(companyId);
  if (role) filter.role = role;
  if (status === "success") filter.success = true;
  if (status === "failed") filter.success = false;
  if (q.trim()) {
    const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ username: { $regex: safe, $options: "i" } }, { name: { $regex: safe, $options: "i" } }, { ip: { $regex: safe, $options: "i" } }];
  }
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(10, Number(pageSize) || 50));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS);

  const [events, total, companies, todayStats, onlineAdmins, onlineAgents] = await Promise.all([
    LoginEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * size)
      .limit(size)
      .lean(),
    LoginEvent.countDocuments(filter),
    Company.find({}).select("name").lean(),
    LoginEvent.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      {
        $group: {
          _id: null,
          logins: { $sum: { $cond: ["$success", 1, 0] } },
          failed: { $sum: { $cond: ["$success", 0, 1] } },
          users: { $addToSet: { $cond: ["$success", "$userId", null] } },
        },
      },
    ]),
    Admin.find({ lastSeenAt: { $gte: onlineSince } }).select("username companyId lastSeenAt").lean(),
    Agent.find({ lastSeenAt: { $gte: onlineSince } }).select("username name companyId lastSeenAt").lean(),
  ]);

  const companyName = Object.fromEntries(companies.map((c) => [String(c._id), c.name]));
  const today = todayStats[0] || { logins: 0, failed: 0, users: [] };

  res.status(200).json({
    events: events.map((e) => ({
      _id: e._id,
      at: e.createdAt,
      success: e.success,
      reason: e.reason || "",
      role: e.role,
      username: e.username,
      name: e.name || "",
      companyId: e.companyId || null,
      companyName: e.companyId ? companyName[String(e.companyId)] || "" : e.role === "super_admin" ? "Platform" : "",
      ip: e.ip || "",
      browser: e.browser || "",
      os: e.os || "",
      deviceType: e.deviceType || "unknown",
      city: e.city || "",
      region: e.region || "",
      country: e.country || "",
      userAgent: e.userAgent || "",
    })),
    total,
    page: pageNum,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
    companies: companies.map((c) => ({ _id: c._id, name: c.name })),
    today: { logins: today.logins, failed: today.failed, uniqueUsers: (today.users || []).filter(Boolean).length },
    online: [
      ...onlineAdmins.map((a) => ({ role: a.companyId ? "admin" : "super_admin", username: a.username, name: "", companyName: a.companyId ? companyName[String(a.companyId)] || "" : "Platform", lastSeenAt: a.lastSeenAt })),
      ...onlineAgents.map((a) => ({ role: "agent", username: a.username, name: a.name, companyName: companyName[String(a.companyId)] || "", lastSeenAt: a.lastSeenAt })),
    ].sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)),
  });
}

export default requireSuperAdmin(handler);
