const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const Settings = require("../../../models/Settings");
const { SHOWROOM_LOCATIONS } = require("../../../lib/leadFields");
const { agentLocations } = require("../../../lib/syncService");

// Which locations an agent can be assigned to, for this company: its fixed
// Settings.locationOptions if configured, else the locations its leads
// actually carry (a company with its own locationField), else the default
// showroom cities. Same precedence as the Leads page's Location filter.
async function locationOptionsFor(companyId) {
  const settings = await Settings.findOne({ companyId }).select("locationField locationOptions").lean();
  if (settings?.locationOptions?.length) return settings.locationOptions;
  if (settings?.locationField) {
    const found = await Lead.distinct("location", { companyId });
    return found.filter(Boolean).sort();
  }
  return SHOWROOM_LOCATIONS;
}

// Normalises a request's location input (array, or legacy single string)
// to a clean list of distinct non-empty strings.
function cleanLocations(locations, location) {
  const list = Array.isArray(locations) ? locations : location !== undefined ? [location] : [];
  return [...new Set(list.map((l) => String(l || "").trim()).filter(Boolean))];
}
const { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH, requireCompanyMemberOrSuperAdminView } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");

async function handler(req, res) {
  await connectDB();

  const { companyId } = req.session;

  if (req.method === "GET") {
    const [agents, locationOptions] = await Promise.all([Agent.find({ companyId }).sort({ createdAt: 1 }).lean(), locationOptionsFor(companyId)]);
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
          locations: agentLocations(a),
          phone: a.phone || "",
          createdAt: a.createdAt,
          leadCount: total,
          contacted: p?.contacted || 0,
          won,
          lost: p?.lost || 0,
          calls: p?.calls || 0,
          winRate: total > 0 ? Math.round((won / total) * 100) : 0,
        };
      }),
      locationOptions,
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
    const { name, username, password, location, locations, phone } = req.body || {};
    const locationList = cleanLocations(locations, location);
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
    const agent = await Agent.create({ name, username, passwordHash, active: true, locations: locationList, location: locationList[0] || "", phone: String(phone || "").trim(), companyId });
    // /api/leads.js caches the active-agent list for its reassign dropdown —
    // a newly-created agent should be selectable right away, not after the cache expires.
    invalidate(`leads-agents:${companyId}`);
    return res.status(201).json({
      agent: { _id: agent._id, name: agent.name, username: agent.username, active: true, location: agent.location, locations: agent.locations, phone: agent.phone },
    });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdminView(handler);
