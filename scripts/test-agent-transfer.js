/* eslint-disable no-console */
// Exercises moving a deactivated agent's leads (lib/agentTransfer.js) against
// a throw-away company: share among active agents, move to one agent,
// unassign, keep, and the won/lost opt-in. Everything created is deleted
// afterwards.
//
//   node scripts/test-agent-transfer.js
const path = require("path");
const fs = require("fs");
for (const file of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const mongoose = require("mongoose");
  const connectDB = require("../lib/db");
  const Company = require("../models/Company");
  const Agent = require("../models/Agent");
  const Lead = require("../models/Lead");
  const WaConversation = require("../models/WaConversation");
  const { agentLeadCounts, transferAgentLeads } = require("../lib/agentTransfer");

  await connectDB();
  const stamp = Date.now();
  const company = await Company.create({ name: "__agent-transfer-test__", slug: `agent-transfer-test-${stamp}`, active: true });
  const companyId = company._id;
  const cleanup = () =>
    Promise.all([
      WaConversation.deleteMany({ companyId }),
      Lead.deleteMany({ companyId }),
      Agent.deleteMany({ companyId }),
      Company.deleteOne({ _id: companyId }),
    ]);

  const mkAgent = (name, locations, active = true) =>
    Agent.create({ name, username: `xfer-${name.toLowerCase()}-${stamp}`, passwordHash: "x", companyId, active, locations, location: locations[0] || "" });
  const mkLead = (name, assignedTo, extra = {}) => ({ companyId, name, canonicalModel: "Q5", model: "Q5", status: "New", source: "Sheet", sheetCreatedAt: new Date(), assignedTo, ...extra });
  const ownerOf = async (name) => String((await Lead.findOne({ companyId, name }).select("assignedTo").lean())?.assignedTo || "");

  // Resets leaving: 4 open leads (2 Hyderabad, 2 Vijayawada), 1 retail, 1 lost; each open lead has a chat.
  async function seed(leaving) {
    await Lead.deleteMany({ companyId });
    await WaConversation.deleteMany({ companyId });
    const leads = await Lead.insertMany([
      mkLead("Open H1", leaving._id, { location: "Hyderabad", phone: "9000000011" }),
      mkLead("Open H2", leaving._id, { location: "Hyderabad", phone: "9000000012" }),
      mkLead("Open V1", leaving._id, { location: "Vijayawada", phone: "9000000013" }),
      mkLead("Open V2", leaving._id, { location: "Vijayawada", phone: "9000000014" }),
      mkLead("Won", leaving._id, { bucket: "retail", status: "Retail (Converted)" }),
      mkLead("Lost", leaving._id, { status: "Lost" }),
    ]);
    await WaConversation.insertMany(
      leads.filter((l) => l.name.startsWith("Open")).map((l) => ({ companyId, leadId: l._id, phone: `91${l.phone}`, assignedTo: leaving._id }))
    );
  }

  try {
    const leaving = await mkAgent("Leaving", ["Hyderabad"]);
    const hyd = await mkAgent("Hyd", ["Hyderabad"]);
    const vij = await mkAgent("Vij", ["Vijayawada"]);

    console.log("\nCounts");
    await seed(leaving);
    const counts = await agentLeadCounts(String(companyId), String(leaving._id));
    check("counts split open vs won/lost", counts.total === 6 && counts.open === 4 && counts.closed === 2, JSON.stringify(counts));

    console.log("\nShare among active agents (auto)");
    await Agent.updateOne({ _id: leaving._id }, { active: false });
    const auto = await transferAgentLeads({ companyId: String(companyId), fromAgentId: String(leaving._id), mode: "auto" });
    check("moves only the 4 open leads", auto.moved === 4, JSON.stringify(auto));
    check("Hyderabad leads go to the Hyderabad agent", (await ownerOf("Open H1")) === String(hyd._id) && (await ownerOf("Open H2")) === String(hyd._id));
    check("Vijayawada leads go to the Vijayawada agent", (await ownerOf("Open V1")) === String(vij._id) && (await ownerOf("Open V2")) === String(vij._id));
    check("won and lost leads stay with the leaving agent", (await ownerOf("Won")) === String(leaving._id) && (await ownerOf("Lost")) === String(leaving._id));
    check("never hands leads back to the deactivated agent", !auto.byAgent.some((b) => b.agentId === String(leaving._id)));
    const chats = await WaConversation.find({ companyId }).lean();
    const leadOwners = new Map((await Lead.find({ companyId }).lean()).map((l) => [String(l._id), String(l.assignedTo)]));
    check("each WhatsApp chat follows its lead", chats.length === 4 && chats.every((c) => String(c.assignedTo) === leadOwners.get(String(c.leadId))));
    check("summary names who got how many", auto.byAgent.length === 2 && auto.byAgent.every((b) => b.name && b.count === 2), JSON.stringify(auto.byAgent));

    console.log("\nMove all to one agent");
    await seed(leaving);
    const one = await transferAgentLeads({ companyId: String(companyId), fromAgentId: String(leaving._id), mode: "agent", toAgentId: String(vij._id) });
    check("all 4 open leads go to the chosen agent", one.moved === 4 && (await Lead.countDocuments({ companyId, assignedTo: vij._id })) === 4);
    check("their chats move too", (await WaConversation.countDocuments({ companyId, assignedTo: vij._id })) === 4);

    console.log("\nInclude won and lost leads");
    await seed(leaving);
    const all = await transferAgentLeads({ companyId: String(companyId), fromAgentId: String(leaving._id), mode: "agent", toAgentId: String(hyd._id), includeClosed: true });
    check("moves all 6 leads", all.moved === 6 && (await Lead.countDocuments({ companyId, assignedTo: leaving._id })) === 0);

    console.log("\nUnassign");
    await seed(leaving);
    const un = await transferAgentLeads({ companyId: String(companyId), fromAgentId: String(leaving._id), mode: "unassign" });
    check("open leads become Unassigned", un.moved === 4 && (await Lead.countDocuments({ companyId, assignedTo: null })) === 4);
    check("their chats become unassigned", (await WaConversation.countDocuments({ companyId, assignedTo: null })) === 4);

    console.log("\nKeep");
    await seed(leaving);
    const keep = await transferAgentLeads({ companyId: String(companyId), fromAgentId: String(leaving._id), mode: "keep" });
    check("nothing moves", keep.moved === 0 && (await Lead.countDocuments({ companyId, assignedTo: leaving._id })) === 6);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    await cleanup();
    await mongoose.disconnect();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
