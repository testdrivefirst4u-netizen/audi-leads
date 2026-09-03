const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const Settings = require("../../../../models/Settings");
const { requireCompanyMember } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../lib/followUps");
const { invalidate } = require("../../../../lib/serverCache");
const { effectiveStatuses } = require("../../../../lib/leadFields");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { status } = req.body || {};

  await connectDB();

  // Validated against this company's own status list (Settings.statusOptions
  // when configured, else the app-wide default) — not the shared Lead
  // model's global default list, since that's no longer schema-enforced.
  const settings = await Settings.findOne({ companyId: req.session.companyId }).select("statusOptions").lean();
  const validStatuses = effectiveStatuses(settings?.statusOptions);
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const filter = leadOwnershipFilter(req.session, id);

  // Same reasoning as remarks.js/calls.js/followups — changing status is the
  // admin/agent actively working this lead, so any follow-up already due
  // (overdue or due today) is resolved by it.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const lead = await Lead.findOneAndUpdate(filter, { status }, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  if (followUpsCleared > 0) invalidate(`followup-tabs:${req.session.companyId}`);

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMember(handler);
