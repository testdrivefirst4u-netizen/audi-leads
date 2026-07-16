const connectDB = require("../../../../../lib/db");
const Lead = require("../../../../../models/Lead");
const { requireCompanyMember } = require("../../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../../lib/leadAccess");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id, followUpId } = req.query;
  const { completed, date } = req.body || {};

  await connectDB();
  const lead = await Lead.findOne({ ...leadOwnershipFilter(req.session, id), "followUps._id": followUpId });
  if (!lead) return res.status(404).json({ error: "Follow-up not found" });

  const followUp = lead.followUps.id(followUpId);

  // Rescheduling (the "snooze" action) — moves the due date out and
  // implicitly reopens it, since a snoozed follow-up is by definition not
  // resolved yet. Checked before the plain completed-toggle branch so a
  // request that sends both isn't ambiguous about which wins.
  if (date !== undefined) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const parsedDate = new Date(isDateOnly ? `${date}T12:00:00Z` : date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }
    followUp.date = parsedDate;
    followUp.completed = false;
    followUp.completedAt = undefined;
  } else if (completed !== undefined) {
    followUp.completed = Boolean(completed);
    followUp.completedAt = followUp.completed ? new Date() : undefined;
  }

  await lead.save();

  res.status(200).json({ lead });
}

export default requireCompanyMember(handler);
