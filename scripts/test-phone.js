/* eslint-disable no-console */
// Checks lib/phone.js — the rules that make Call / WhatsApp dial the right
// number and let a hand-added lead match an existing one whatever shape its
// phone was stored in. Pure functions, no database: also run by the GitHub
// build check (.github/workflows/ci.yml).
//
//   node scripts/test-phone.js
const path = require("path");
const fs = require("fs");
const vm = require("vm");

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// lib/phone.js is an ES module for the browser bundle; load its exports here
// without a compiler by evaluating it as a plain script.
function loadEsm(file) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/^export (?=(const|function))/gm, "");
  const names = [...src.matchAll(/^(?:const|function) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  const sandbox = {};
  vm.runInNewContext(`${src}\n;__out = { ${names.join(", ")} };`, sandbox);
  return sandbox.__out;
}

const { intlDigits, storedPhone, phoneVariants, telHref, waHref } = loadEsm("lib/phone.js");

console.log("Dialling");
check("10 digits get +91", telHref("98200 11223") === "tel:+919820011223", telHref("98200 11223"));
check("already 91-prefixed stays", telHref("919949475601") === "tel:+919949475601");
check("+91 with spaces", intlDigits("+91 99494 75601") === "919949475601");
check("leading 0 replaced by 91", intlDigits("09820011223") === "919820011223");
check("foreign number left alone", intlDigits("+44 20 7946 0958") === "442079460958");
check("WhatsApp link with text", waHref("9820011223", "Hi there") === "https://wa.me/919820011223?text=Hi%20there", waHref("9820011223", "Hi there"));
check("empty phone gives empty digits", intlDigits("") === "");

console.log("Stored form");
check("91-prefixed → 10 digits", storedPhone("919949475601") === "9949475601");
check("0-prefixed → 10 digits", storedPhone("09820011223") === "9820011223");
check("10 digits unchanged", storedPhone("98200 11223") === "9820011223");

console.log("Matching an existing lead");
const v = phoneVariants("98200 11223");
check("10-digit typed matches a Meta lead's 91 number", v.includes("919820011223"), v.join(","));
check("…and a sheet's 10-digit number", v.includes("9820011223"));
check("…and a 0-prefixed one", v.includes("09820011223"));
const v2 = phoneVariants("+91 99494 75601");
check("91 typed matches a 10-digit lead", v2.includes("9949475601"), v2.join(","));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
