/* eslint-disable no-console */
// Checks lib/meta/capi.js's payload rules — which leads count as Meta leads,
// event names, hashing and the lead_id encoding. Pure functions, no database
// or network: also run by the GitHub build check (.github/workflows/ci.yml).
//
//   node scripts/test-capi.js
const crypto = require("crypto");
const { metaLeadIdOf, eventNameFor, buildEvent, serialize, hashedPhone, hashedEmail } = require("../lib/meta/capi");

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");

console.log("Meta lead ID");
check("from the leadgen webhook", metaLeadIdOf({ metaLeadId: "1234567890123456" }) === "1234567890123456");
check("from a Meta export sheet's id column (l: prefix)", metaLeadIdOf({ data: { id: "l:9876543210987654" } }) === "9876543210987654");
check("from a sheet id without the prefix", metaLeadIdOf({ data: { id: "9876543210987654" } }) === "9876543210987654");
check("not for a hand-added or other-source lead", metaLeadIdOf({ data: { id: "42" } }) === null && metaLeadIdOf({}) === null);

console.log("Event");
check("the New status is sent as Meta's raw-lead stage \"Lead\"", eventNameFor("New") === "Lead");
check("status names become valid event names", eventNameFor("Retail (Converted)") === "Retail Converted" && eventNameFor("Test Drive") === "Test Drive");
check("10-digit Indian phone hashed with 91", hashedPhone("99494 75601") === sha("919949475601"));
check("phone already with 91 unchanged", hashedPhone("+91 9949475601") === sha("919949475601"));
check("email lower-cased and trimmed before hashing", hashedEmail(" Ravi@Example.COM ") === sha("ravi@example.com"));
check("bad email dropped", hashedEmail("not-an-email") === null);

const lead = { _id: "abc123", metaLeadId: "1234567890123456789", phone: "9949475601", email: "", name: "Ravi" };
const ev = buildEvent(lead, "Test Drive", new Date("2026-11-20T10:00:00Z"));
check("system_generated CRM event", ev.action_source === "system_generated" && ev.custom_data.event_source === "crm");
check("event_id is lead + stage (so Meta dedupes too)", ev.event_id === "abc123:Test Drive");
check("event_time in seconds", ev.event_time === 1795168800);
check("no em when the lead has no email", !("em" in ev.user_data) && ev.user_data.ph.length === 1);
const json = serialize({ data: [ev] });
check("lead_id sent as the exact 19-digit number", json.includes('"lead_id":1234567890123456789') && !json.includes('"lead_id":"'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
