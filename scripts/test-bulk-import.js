/* eslint-disable no-console */
// Correctness + speed check for lib/leadIngest.js's bulkDedupeAndCreateLeads
// (the Excel import path), against a throw-away company that is deleted at
// the end. Mock data only.
//
//   node scripts/test-bulk-import.js
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
  const connectDB = require("../lib/db");
  const mongoose = require("mongoose");
  const Company = require("../models/Company");
  const Agent = require("../models/Agent");
  const Lead = require("../models/Lead");
  const { bulkDedupeAndCreateLeads, dedupeAndCreateLead } = require("../lib/leadIngest");
  const { createAgentAssigner } = require("../lib/syncService");

  await connectDB();
  const company = await Company.create({ name: "__bulk-import-test__", slug: `bulk-test-${Date.now()}`, active: true });
  const cleanup = async () => {
    await Lead.deleteMany({ companyId: company._id });
    await Agent.deleteMany({ companyId: company._id });
    await Company.deleteOne({ _id: company._id });
  };
  try {
    const hyd = await Agent.create({ name: "Hyd Agent", username: `bulk-hyd-${Date.now()}`, passwordHash: "x", companyId: company._id, locations: ["Hyderabad"], location: "Hyderabad" });
    const multi = await Agent.create({ name: "Multi Agent", username: `bulk-multi-${Date.now()}`, passwordHash: "x", companyId: company._id, locations: ["Vijayawada", "Visakhapatnam"], location: "Vijayawada" });
    const entry = (phone, model, extra = {}) => ({
      phone,
      name: `Cust ${phone}`,
      model,
      canonicalModel: model,
      data: {},
      source: "Test Import",
      sheetCreatedAt: new Date(),
      ...extra,
    });

    // Batch 1: in-batch repeat, new model for an existing customer, email-only lead.
    let assignNext = await createAgentAssigner(company._id);
    const r1 = await bulkDedupeAndCreateLeads({
      companyId: company._id,
      assignNext,
      entries: [
        entry("911111111111", "Q5", { location: "Hyderabad" }),
        entry("922222222222", "Q3", { location: "Visakhapatnam" }),
        entry("911111111111", "Q5", { location: "Hyderabad" }), // repeat of row 1, same batch
        entry("911111111111", "Q3", { location: "Hyderabad" }), // same customer, different model
        entry(undefined, "Q7", { email: "only@example.com", location: "Vijayawada" }),
      ],
    });
    check("statuses decided in file order", JSON.stringify(r1.map((r) => r.status)) === JSON.stringify(["created", "created", "duplicate", "created", "created"]));
    const a = await Lead.findOne({ companyId: company._id, phone: "911111111111", canonicalModel: "Q5" }).lean();
    check("in-batch repeat folded into the earlier lead (2 enquiries, duplicateCount 1)", a && a.enquiryHistory.length === 2 && a.duplicateCount === 1);
    const a3 = await Lead.findOne({ companyId: company._id, phone: "911111111111", canonicalModel: "Q3" }).lean();
    check("same customer, other model → new lead typed new_model_existing_customer", a3 && a3.leadType === "new_model_existing_customer");
    check("schema defaults applied by insertMany (status New, bucket unassigned)", a.status === "New" && a.bucket === "unassigned");
    check("Hyderabad lead assigned to the Hyderabad agent", String(a.assignedTo) === String(hyd._id));
    const b = await Lead.findOne({ companyId: company._id, phone: "922222222222" }).lean();
    const c = await Lead.findOne({ companyId: company._id, email: "only@example.com" }).lean();
    check("multi-location agent covers both Visakhapatnam and Vijayawada leads", String(b.assignedTo) === String(multi._id) && String(c.assignedTo) === String(multi._id));
    check("email-only lead created", c && !c.phone && c.leadType === "new");
    check("total documents = 4", (await Lead.countDocuments({ companyId: company._id })) === 4);

    // Batch 2: repeat against what is already in the DB + cross-check with the one-row path.
    assignNext = await createAgentAssigner(company._id);
    const r2 = await bulkDedupeAndCreateLeads({ companyId: company._id, assignNext, entries: [entry("911111111111", "Q5"), entry("933333333333", "Q5", { location: "Hyderabad" })] });
    const a2 = await Lead.findOne({ companyId: company._id, phone: "911111111111", canonicalModel: "Q5" }).lean();
    check("repeat against existing DB lead → duplicate, history 3, duplicateCount 2", r2[0].status === "duplicate" && a2.enquiryHistory.length === 3 && a2.duplicateCount === 2);
    const single = await dedupeAndCreateLead({ companyId: company._id, ...entry("911111111111", "Q5"), assignNext });
    check("one-row path agrees with the bulk path (duplicate, count 3)", single.status === "duplicate" && single.lead.duplicateCount === 3);

    // Speed: 2,000 rows in one call.
    const big = Array.from({ length: 2000 }, (_, i) => entry(`95${String(i).padStart(10, "0")}`, ["Q3", "Q5", "Q7", "A6"][i % 4], { location: ["Hyderabad", "Vijayawada", "Visakhapatnam"][i % 3] }));
    assignNext = await createAgentAssigner(company._id);
    const t0 = Date.now();
    const r3 = await bulkDedupeAndCreateLeads({ companyId: company._id, assignNext, entries: big });
    const ms = Date.now() - t0;
    check(`2,000 rows ingested in ${ms} ms (${(ms / 2000).toFixed(1)} ms/row)`, r3.length === 2000 && ms < 30000);
    check("all 2,000 created", r3.every((r) => r.status === "created") && (await Lead.countDocuments({ companyId: company._id })) === 2005);
  } finally {
    await cleanup();
    console.log("  (test company removed)");
  }
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
