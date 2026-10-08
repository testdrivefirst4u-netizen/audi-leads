const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const Company = require("../../../models/Company");
const { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH, requireAuth } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");
const { agentLeadCounts, transferAgentLeads, TRANSFER_MODES } = require("../../../lib/agentTransfer");

// Day-to-day agent management is for the company's own admin, or the super
// admin acting on a company via ?companyId= (same convention as everywhere
// else). Sessions issued before agent accounts existed have no role claim —
// treated as admin, matching lib/auth.js's requireAdmin. Returns an error
// response, or null once req.session.companyId is set.
async function resolveAdminCompany(req, res) {
  if (req.session.role === "super_admin") {
    const companyId = req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    const company = await Company.findById(companyId).select("_id").lean();
    if (!company) return res.status(404).json({ error: "Company not found" });
    req.session.companyId = String(companyId);
  } else if (req.session.role && req.session.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  if (!req.session.companyId) {
    return res.status(403).json({ error: "This account is not a member of a company" });
  }
  return null;
}

async function handler(req, res) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "GET") {
    // Lead counts for the deactivate dialog: how many open leads would need
    // a new owner, and how many closed (won/lost) ones stay by default.
    const denied = await resolveAdminCompany(req, res);
    if (denied) return denied;
    const agent = await Agent.findOne({ _id: id, companyId: req.session.companyId }).select("name active").lean();
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const leads = await agentLeadCounts(req.session.companyId, id);
    return res.status(200).json({ agent: { _id: agent._id, name: agent.name, active: agent.active }, leads });
  }

  if (req.method === "PATCH") {
    // Activate/deactivate, relocate, rename, reset password.
    const denied = await resolveAdminCompany(req, res);
    if (denied) return denied;

    const { active, name, password, location, locations, phone, transfer } = req.body || {};
    if (password && !isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    // Deactivating can hand the agent's leads to someone else (see
    // lib/agentTransfer.js). Validate everything up front so a bad target
    // never leaves the agent deactivated with their leads stranded.
    const mode = transfer?.mode || "keep";
    if (transfer && active !== false) {
      return res.status(400).json({ error: "Leads can only be transferred when deactivating an agent" });
    }
    if (!TRANSFER_MODES.includes(mode)) {
      return res.status(400).json({ error: `transfer.mode must be one of: ${TRANSFER_MODES.join(", ")}` });
    }
    if (mode === "agent") {
      if (!transfer.toAgentId || String(transfer.toAgentId) === String(id)) {
        return res.status(400).json({ error: "Pick a different agent to receive the leads" });
      }
      const target = await Agent.findOne({ _id: transfer.toAgentId, companyId: req.session.companyId, active: true }).select("_id").lean();
      if (!target) return res.status(400).json({ error: "That agent isn't an active agent in this company" });
    }
    if (mode === "auto") {
      const others = await Agent.countDocuments({ companyId: req.session.companyId, active: true, _id: { $ne: id } });
      if (others === 0) return res.status(400).json({ error: "There are no other active agents to share the leads with" });
    }
    const update = {};
    if (active !== undefined) update.active = Boolean(active);
    if (name !== undefined) update.name = String(name).trim();
    if (phone !== undefined) update.phone = String(phone || "").trim();
    if (locations !== undefined || location !== undefined) {
      const list = Array.isArray(locations) ? locations : [location];
      update.locations = [...new Set(list.map((l) => String(l || "").trim()).filter(Boolean))];
      update.location = update.locations[0] || "";
    }
    if (password) update.passwordHash = await hashPassword(password);

    const agent = await Agent.findOneAndUpdate({ _id: id, companyId: req.session.companyId }, update, { new: true });
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    // Active/name changes affect the cached reassign dropdown list.
    invalidate(`leads-agents:${req.session.companyId}`);

    // Runs after the deactivation above, so "auto" can't pick this agent.
    const transferred =
      active === false && mode !== "keep"
        ? await transferAgentLeads({
            companyId: req.session.companyId,
            fromAgentId: id,
            mode,
            toAgentId: transfer.toAgentId,
            includeClosed: Boolean(transfer.includeClosed),
          })
        : null;

    return res.status(200).json({
      agent: { _id: agent._id, name: agent.name, username: agent.username, active: agent.active, location: agent.location, locations: agent.locations || [] },
      transferred,
    });
  }

  if (req.method === "DELETE") {
    // Deleting an agent outright — distinct from the deactivate toggle above
    // — is a super-admin-only action, symmetric with agent creation (see
    // pages/api/agents/index.js). Needs ?companyId= the same way, since a
    // super-admin session has no company of its own.
    if (req.session.role !== "super_admin") {
      return res.status(403).json({ error: "Super admin access required" });
    }
    const companyId = req.query.companyId;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    const company = await Company.findById(companyId).select("_id").lean();
    if (!company) return res.status(404).json({ error: "Company not found" });

    const agent = await Agent.findOne({ _id: id, companyId }).select("_id").lean();
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Leads assigned to a deleted agent fall back to Unassigned rather than
    // keeping a reference to a record that no longer exists — same state as
    // if they'd never been assigned, not silently dangling.
    await Lead.updateMany({ companyId, assignedTo: id }, { $set: { assignedTo: null } });
    await Agent.deleteOne({ _id: id, companyId });
    invalidate(`leads-agents:${companyId}`);

    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireAuth(handler);
