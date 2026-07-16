const connectDB = require("../../../../../lib/db");
const Lead = require("../../../../../models/Lead");
const { requireCompanyMember } = require("../../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../../lib/followUps");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { date, note } = req.body || {};
  if (!date) return res.status(400).json({ error: "Follow-up date is required" });

  // A bare "YYYY-MM-DD" from <input type="date"> parses as UTC midnight, which
  // can render as the previous/next calendar day in timezones far from UTC.
  // Anchoring at noon UTC keeps the same calendar date for any local timezone.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const parsedDate = new Date(isDateOnly ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: "Invalid date" });
  }

  await connectDB();
  const filter = leadOwnershipFilter(req.session, id);

  // Same reasoning as remarks.js/calls.js — scheduling a new follow-up is
  // the agent acting on this lead, so any follow-up already due (overdue or
  // due today) is resolved by it. Done before the $push below so the
  // brand-new entry (which could itself be dated today) is never in scope
  // to be matched and instantly marked complete.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const lead = await Lead.findOneAndUpdate(
    filter,
    { $push: { followUps: { date: parsedDate, note: (note || "").trim(), completed: false } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMember(handler);
