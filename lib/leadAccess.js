// Agents can only read/mutate leads assigned to them. Folding the ownership
// check into the lookup filter (rather than fetching then checking) means an
// agent probing another agent's lead ID just gets a 404, not a 403 that
// would leak whether the ID exists.
function leadOwnershipFilter(session, id) {
  return session.role === "agent" ? { _id: id, assignedTo: session.agentId } : { _id: id };
}

module.exports = { leadOwnershipFilter };
