// Marks a lead's pending follow-ups that are already due (overdue or due
// today) as completed — shared by every action that represents the agent
// following through on a lead (remark, call, new follow-up, status change),
// so "resolved by contact" behaves identically everywhere instead of each
// route reimplementing its own version of this. Returns how many follow-ups
// were actually cleared, so callers can surface it (e.g. as a toast) rather
// than changing data silently.
async function completeDueFollowUps(Lead, filter) {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const before = await Lead.findOne(filter).select("followUps").lean();
  if (!before) return 0;

  const dueCount = (before.followUps || []).filter(
    (f) => !f.completed && new Date(f.date) <= endOfToday
  ).length;
  if (dueCount === 0) return 0;

  await Lead.updateOne(
    filter,
    { $set: { "followUps.$[due].completed": true, "followUps.$[due].completedAt": new Date() } },
    { arrayFilters: [{ "due.completed": false, "due.date": { $lte: endOfToday } }] }
  );

  return dueCount;
}

module.exports = { completeDueFollowUps };
