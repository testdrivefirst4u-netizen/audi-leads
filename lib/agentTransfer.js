const mongoose = require("mongoose");
const Agent = require("../models/Agent");
const Lead = require("../models/Lead");
const WaConversation = require("../models/WaConversation");
const { createAgentAssigner } = require("./syncService");

// A lead is "closed" once it's won or lost — by bucket or by status, since
// the two are edited independently. Closed leads stay with the agent who
// handled them by default, so their win/loss history isn't rewritten.
const CLOSED_FILTER = {
  $or: [{ bucket: { $in: ["retail", "lost"] } }, { status: { $in: ["Retail (Converted)", "Lost"] } }],
};

const TRANSFER_MODES = ["auto", "agent", "unassign", "keep"];

function oid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

// Open/closed lead counts for one agent — what the deactivate dialog shows.
async function agentLeadCounts(companyId, agentId) {
  const base = { companyId: oid(companyId), assignedTo: oid(agentId) };
  const [total, closed] = await Promise.all([Lead.countDocuments(base), Lead.countDocuments({ ...base, ...CLOSED_FILTER })]);
  return { total, open: total - closed, closed };
}

// Moves an agent's leads (and each lead's WhatsApp conversation) according
// to `mode`:
//   auto     — spread across the other active agents, least-loaded first and
//              matched on showroom location (the same rule new leads use)
//   agent    — all to `toAgentId`
//   unassign — back to Unassigned
//   keep     — nothing moves
// Call it AFTER the agent is deactivated, so "auto" never hands leads back
// to them. Returns { moved, byAgent: [{ agentId, name, count }] }.
async function transferAgentLeads({ companyId, fromAgentId, mode, toAgentId, includeClosed = false }) {
  if (mode === "keep") return { moved: 0, byAgent: [] };

  const filter = { companyId: oid(companyId), assignedTo: oid(fromAgentId) };
  if (!includeClosed) filter.$nor = [CLOSED_FILTER];

  if (mode === "agent" || mode === "unassign") {
    const target = mode === "agent" ? oid(toAgentId) : null;
    const ids = await Lead.find(filter).distinct("_id");
    if (ids.length === 0) return { moved: 0, byAgent: [] };
    await Lead.updateMany({ _id: { $in: ids } }, { $set: { assignedTo: target } });
    await WaConversation.updateMany({ companyId: oid(companyId), leadId: { $in: ids } }, { $set: { assignedTo: target } });
    if (!target) return { moved: ids.length, byAgent: [] };
    const agent = await Agent.findById(target).select("name").lean();
    return { moved: ids.length, byAgent: [{ agentId: String(target), name: agent?.name || "", count: ids.length }] };
  }

  // auto
  const assignNext = await createAgentAssigner(oid(companyId));
  const leads = await Lead.find(filter).select("_id location").lean();
  const leadOps = [];
  const chatOps = [];
  const tally = new Map();
  for (const lead of leads) {
    const agentId = assignNext(lead.location);
    if (!agentId) break; // no active agents left to share with
    const target = oid(agentId);
    leadOps.push({ updateOne: { filter: { _id: lead._id }, update: { $set: { assignedTo: target } } } });
    chatOps.push({ updateMany: { filter: { companyId: oid(companyId), leadId: lead._id }, update: { $set: { assignedTo: target } } } });
    tally.set(agentId, (tally.get(agentId) || 0) + 1);
  }
  if (leadOps.length) {
    await Lead.bulkWrite(leadOps, { ordered: false });
    await WaConversation.bulkWrite(chatOps, { ordered: false });
  }
  const names = await Agent.find({ _id: { $in: [...tally.keys()].map(oid) } }).select("name").lean();
  const nameMap = new Map(names.map((a) => [String(a._id), a.name]));
  const byAgent = [...tally.entries()].map(([agentId, count]) => ({ agentId, name: nameMap.get(agentId) || "", count })).sort((a, b) => b.count - a.count);
  return { moved: leadOps.length, byAgent };
}

module.exports = { agentLeadCounts, transferAgentLeads, TRANSFER_MODES, CLOSED_FILTER };
