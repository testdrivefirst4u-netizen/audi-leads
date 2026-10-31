/* eslint-disable no-console */
// Checks lib/catalogImport.js — how a Models spreadsheet is matched against
// and merged into the stored catalog. Pure functions, no database: also run
// by the GitHub build check (.github/workflows/ci.yml).
//
//   node scripts/test-catalog-import.js
process.env.IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/test";
const { planImport } = require("../lib/catalogImport");

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const existing = [
  { _id: "m1", name: "Q5", aliases: ["Audi Q5"], onSale: true, variants: [{ name: "Premium Plus", exShowroomPrice: 6500000, onRoadPrice: 7800000 }], colours: [], files: [], gallery: [], specs: [{ group: "Old", name: "Old spec", value: "x" }], faqs: [] },
];
const sheets = {
  Models: [{ Model: "Q5", Highlights: "quattro AWD | Virtual cockpit", "Body type": "SUV" }, { Model: "A6", Tagline: "Executive sedan" }],
  Variants: [
    { Model: "Audi Q5", Variant: "premium plus", "Ex-showroom price (Rs)": "66,99,000", "On-road price": "80,10,000", "Price city": "Hyderabad", "Price date": "2026-11-01" },
    { Model: "Q5", Variant: "Technology", "Ex-showroom price": "72,00,000" },
    { Model: "", Variant: "Orphan" },
  ],
  Specs: [{ Model: "Q5", Group: "Dimensions", Name: "Boot space", Value: "520 litres" }],
  Colours: [{ Model: "Q5", Colour: "Navarra Blue", Hex: "1f3a6b" }],
  "Quick answers": [{ Model: "A6", Question: "Warranty?", Answer: "2 years unlimited km" }],
};
const { plan, warnings } = planImport(existing, sheets, "c1");
const q5 = plan.find((p) => p.name === "Q5");
const a6 = plan.find((p) => p.name === "A6");

console.log("Matching");
check("model matched by alias, not duplicated", plan.length === 2 && q5?.action === "update", plan.map((p) => `${p.action} ${p.name}`).join(", "));
check("new model is created", a6?.action === "create");
check("variant matched ignoring case, keeps stored name", q5.value.variants[0].name === "Premium Plus" && q5.value.variants.length === 2);
check("row without a model is skipped with a warning", warnings.some((w) => /no model name/.test(w)));

console.log("Values");
check("prices with Indian commas parsed", q5.value.variants[0].exShowroomPrice === 6699000 && q5.value.variants[0].onRoadPrice === 8010000);
check("new variant added", q5.value.variants[1].name === "Technology" && q5.value.variants[1].exShowroomPrice === 7200000);
check("price city and date set", q5.value.priceCity === "Hyderabad" && q5.value.priceAsOf?.toISOString().slice(0, 10) === "2026-11-01");
check("highlights split on |", q5.value.highlights.join(",") === "quattro AWD,Virtual cockpit");
check("specs replaced by the sheet's rows", q5.value.specs.length === 1 && q5.value.specs[0].name === "Boot space");
check("colour hex gets its #", q5.value.colours[0].hex === "#1f3a6b");
check("quick answers on the new model", a6.value.faqs.length === 1);
check("no validation errors", plan.every((p) => p.errors.length === 0), plan.flatMap((p) => p.errors).join("; "));
check("change summary names the price update", q5.changes.includes("Premium Plus price updated"), q5.changes.join("; "));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
