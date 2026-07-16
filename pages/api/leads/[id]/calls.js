const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireCompanyMember } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../lib/followUps");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { note } = req.body || {};

  await connectDB();
  const filter = leadOwnershipFilter(req.session, id);

  // Same reasoning as remarks.js — logging a call is the agent acting on
  // this lead, so any follow-up already due (overdue or due today) is
  // resolved by it. A future-scheduled follow-up is left alone.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const lead = await Lead.findOneAndUpdate(
    filter,
    { $push: { calls: { calledAt: new Date(), note: (note || "").trim() } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMember(handler);
