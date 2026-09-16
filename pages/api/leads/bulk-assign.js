const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const Agent = require("../../../models/Agent");
const { requireAdminOrSuperAdmin } = require("../../../lib/auth");

// Hard cap on one request — "select all matching" on the Leads page can
// hand over every lead in a company, and a single updateMany over a few
// thousand ids is fine, but an unbounded body is not.
const MAX_IDS = 5000;

// Assigns (or unassigns, with agentId null) many leads to one agent in a
// single write — the bulk counterpart of /api/leads/[id]/assign.js, same
// rules: admin/super admin only, the agent must belong to this company,
// and leads outside the company are silently ignored by the companyId
// filter rather than reported (no probing of other tenants' ids).
async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { leadIds, agentId } = req.body || {};
  const { companyId } = req.session;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: "leadIds must be a non-empty array" });
  }
  if (leadIds.length > MAX_IDS) {
    return res.status(400).json({ error: `At most ${MAX_IDS} leads can be assigned at once` });
  }
  const ids = [...new Set(leadIds.map((id) => String(id)).filter((id) => /^[a-f\d]{24}$/i.test(id)))];

  await connectDB();

  let agent = null;
  if (agentId) {
    agent = await Agent.findOne({ _id: agentId, companyId }).select("name active").lean();
    if (!agent) return res.status(400).json({ error: "Invalid agent" });
  }

  const result = await Lead.updateMany({ _id: { $in: ids }, companyId }, { $set: { assignedTo: agentId || null } });

  // Hand back the updated rows so the table can refresh in place without a
  // full refetch (which would also lose the user's current page/filters).
  const leads = await Lead.find({ _id: { $in: ids }, companyId }).populate("assignedTo", "name").lean();

  res.status(200).json({
    updated: result.modifiedCount,
    matched: result.matchedCount,
    agent: agent ? { _id: agentId, name: agent.name } : null,
    leads,
  });
}

export default requireAdminOrSuperAdmin(handler);
