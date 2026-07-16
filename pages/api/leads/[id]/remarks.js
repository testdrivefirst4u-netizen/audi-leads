const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireCompanyMember } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../lib/followUps");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Remark text is required" });
  }

  await connectDB();
  const filter = leadOwnershipFilter(req.session, id);

  // Adding a remark means the agent just acted on this lead — any follow-up
  // that was already due (overdue or due today) is resolved by that action,
  // so it shouldn't keep sitting in the Overdue/Due Today tabs. Done before
  // the $push below so the count reflects only pre-existing follow-ups.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const lead = await Lead.findOneAndUpdate(
    filter,
    { $push: { remarks: { text: text.trim(), createdAt: new Date() } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMember(handler);
