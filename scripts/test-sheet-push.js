/* eslint-disable no-console */
// Checks the instant sheet-push endpoint (POST /api/public/sheet-rows)
// against the running dev server, using a throw-away company + API key
// that are deleted afterwards. Mock data only.
//
//   node scripts/test-sheet-push.js
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
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
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
  const Settings = require("../models/Settings");
  const Agent = require("../models/Agent");
  const Lead = require("../models/Lead");
  const ApiKey = require("../models/ApiKey");
  const ApiKeyLog = require("../models/ApiKeyLog");
  const { generateApiKey, hashApiKey, displayPrefix } = require("../lib/apiKeys");

  await connectDB();
  const company = await Company.create({ name: "__sheet-push-test__", slug: `sheet-push-${Date.now()}`, active: true });
  const cleanup = async () => {
    await Promise.all([
      Lead.deleteMany({ companyId: company._id }),
      Agent.deleteMany({ companyId: company._id }),
      ApiKeyLog.deleteMany({ companyId: company._id }),
      ApiKey.deleteMany({ companyId: company._id }),
      Settings.deleteMany({ companyId: company._id }),
      Company.deleteOne({ _id: company._id }),
    ]);
  };
  try {
    const agent = await Agent.create({ name: "Push Agent", username: `push-agent-${Date.now()}`, passwordHash: "x", companyId: company._id, active: true });
    await Settings.create({ companyId: company._id, sheets: [{ label: "Primary", sheetId: "SHEET_TEST_ID", sheetName: "" }] });
    const rawKey = generateApiKey();
    await ApiKey.create({ companyId: company._id, sourceName: "Google Sheets", keyHash: hashApiKey(rawKey), keyPrefix: displayPrefix(rawKey), active: true });

    const post = (body, key = rawKey) =>
      fetch(`${BASE_URL}/api/public/sheet-rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      });
    const row = (rowNumber, phone, name, created = "2026-09-18 10:15:00") => ({
      rowNumber,
      record: { id: `l:9${rowNumber}0000`, created_time: created, full_name: name, phone_number: `p:+${phone}`, email: `${name.toLowerCase().replace(/\s/g, "")}@example.com`, city: "Hyderabad" },
    });

    let r = await post({ tab: "Q5", rows: [row(5, "919111111111", "Push One")] }, "");
    check("no API key → 401", r.status === 401);
    r = await post({ tab: "Q5", rows: [row(5, "919111111111", "Push One")] }, "lead_notakey");
    check("bad API key → 401", r.status === 401);
    r = await post({ sheetId: "OTHER_SHEET", tab: "Q5", rows: [row(5, "919111111111", "Push One")] });
    check("a spreadsheet not connected to the company is refused", r.status === 400);

    const t0 = Date.now();
    r = await post({ sheetId: "SHEET_TEST_ID", tab: "Q5", rows: [row(5, "919111111111", "Push One"), row(6, "919222222222", "Push Two")] });
    let j = await r.json();
    check(`two new rows → two leads in ${Date.now() - t0} ms`, r.status === 200 && j.newCount === 2, JSON.stringify(j));
    const lead = await Lead.findOne({ companyId: company._id, phone: "919111111111" }).lean();
    check("lead carries tab as model, rowNumber, sheet id, phone cleaned, auto-assigned", lead && lead.model === "Q5" && lead.canonicalModel === "Q5" && lead.rowNumber === 5 && lead.leadId === "l:950000".replace("l:", "") && String(lead.assignedTo) === String(agent._id), JSON.stringify({ model: lead?.model, rowNumber: lead?.rowNumber, leadId: lead?.leadId }));
    check("created date taken from the sheet's created_time", lead && new Date(lead.sheetCreatedAt).getFullYear() === 2026);

    r = await post({ sheetId: "SHEET_TEST_ID", tab: "Q5", rows: [row(5, "919111111111", "Push One"), row(6, "919222222222", "Push Two")] });
    j = await r.json();
    check("re-pushing the same rows is idempotent (unchanged, no new leads)", j.newCount === 0 && j.unchangedCount === 2 && (await Lead.countDocuments({ companyId: company._id })) === 2);

    r = await post({ sheetId: "SHEET_TEST_ID", tab: "Q5", rows: [row(7, "919111111111", "Push One Again")] });
    j = await r.json();
    const again = await Lead.findOne({ companyId: company._id, phone: "919111111111" }).lean();
    check("same customer + model on a new row → repeat enquiry, not a new lead", j.duplicateCount === 1 && again.duplicateCount === 1 && again.enquiryHistory.length === 2);

    r = await post({ sheetId: "SHEET_TEST_ID", tab: "Q3", rows: [{ rowNumber: 2, record: { full_name: "<test lead: dummy data for full_name>", phone_number: "<test lead: dummy data for phone_number>" } }] });
    j = await r.json();
    check("Meta test-lead rows are skipped, same as the sync", j.skippedCount === 1 && j.newCount === 0);

    const logs = await ApiKeyLog.countDocuments({ companyId: company._id });
    check("deliveries are logged against the API key", logs >= 4);
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
