const connectDB = require("../../../lib/db");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const Company = require("../../../models/Company");
const { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH, requireAuth } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");

async function handler(req, res) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "PATCH") {
    // Day-to-day agent management (activate/deactivate, relocate, rename,
    // reset password) stays company-admin-only — same access as before.
    // Sessions issued before agent accounts existed have no role claim —
    // treated as admin, matching lib/auth.js's requireAdmin.
    if (req.session.role && req.session.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    if (!req.session.companyId) {
      return res.status(403).json({ error: "This account is not a member of a company" });
    }

    const { active, name, password, location } = req.body || {};
    if (password && !isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const update = {};
    if (active !== undefined) update.active = Boolean(active);
    if (name !== undefined) update.name = String(name).trim();
    if (location !== undefined) update.location = String(location).trim();
    if (password) update.passwordHash = await hashPassword(password);

    const agent = await Agent.findOneAndUpdate({ _id: id, companyId: req.session.companyId }, update, { new: true });
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    // Active/name changes affect the cached reassign dropdown list.
    invalidate(`leads-agents:${req.session.companyId}`);

    return res.status(200).json({
      agent: { _id: agent._id, name: agent.name, username: agent.username, active: agent.active, location: agent.location },
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
