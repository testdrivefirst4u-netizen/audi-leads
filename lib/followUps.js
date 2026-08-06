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

  // One round trip instead of two: findOneAndUpdate with arrayFilters that
  // match zero elements is a safe, well-defined no-op (MongoDB just doesn't
  // change anything), and Mongoose returns the PRE-update document by
  // default (new: false) — so the same call both performs the update *and*
  // hands back the exact snapshot needed to count how many were due,
  // without a separate findOne first.
  const before = await Lead.findOneAndUpdate(
    filter,
    { $set: { "followUps.$[due].completed": true, "followUps.$[due].completedAt": new Date() } },
    { arrayFilters: [{ "due.completed": false, "due.date": { $lte: endOfToday } }], new: false }
  )
    .select("followUps")
    .lean();
  if (!before) return 0;

  return (before.followUps || []).filter((f) => !f.completed && new Date(f.date) <= endOfToday).length;
}

module.exports = { completeDueFollowUps };
