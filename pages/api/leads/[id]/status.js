const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireCompanyMember } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../lib/followUps");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { status } = req.body || {};
  if (!Lead.LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Lead.LEAD_STATUSES.join(", ")}` });
  }

  await connectDB();
  const filter = leadOwnershipFilter(req.session, id);

  // Same reasoning as remarks.js/calls.js/followups — changing status is the
  // admin/agent actively working this lead, so any follow-up already due
  // (overdue or due today) is resolved by it.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const lead = await Lead.findOneAndUpdate(filter, { status }, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMember(handler);
