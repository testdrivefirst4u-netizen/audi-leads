// Agents can only read/mutate leads assigned to them, and no one can touch a
// lead outside their own company. Folding both checks into the lookup filter
// (rather than fetching then checking) means probing another company's or
// another agent's lead ID just gets a 404, not a 403 that would leak whether
// the ID exists.
function leadOwnershipFilter(session, id) {
  const filter = { _id: id, companyId: session.companyId };
  if (session.role === "agent") filter.assignedTo = session.agentId;
  return filter;
}

module.exports = { leadOwnershipFilter };
