/* eslint-disable no-console */
// Checks the car catalog: save validation (lib/catalogInput.js), who may
// edit, lead-to-model matching (lib/catalog.js), and the per-company
// case-insensitive unique name, against a throw-away company that is deleted
// afterwards.
//
//   node scripts/test-catalog.js
const path = require("path");
const fs = require("fs");
const vm = require("vm");
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

// lib/catalog.js is an ES module for the browser bundle; load its exports here
// without a compiler by evaluating it as a plain script.
function loadEsm(file) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/^export (?=(const|function))/gm, "");
  const names = [...src.matchAll(/^(?:const|function) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  const sandbox = { Intl, module: { exports: {} } };
  vm.runInNewContext(`${src}\nmodule.exports = { ${names.join(", ")} };`, sandbox);
  return sandbox.module.exports;
}

(async () => {
  process.env.IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/test";
  const { canEditCatalog, cleanModelInput, fileIdsOf, assetPrefix } = require("../lib/catalogInput");
  const catalog = loadEsm("lib/catalog.js");
  const cid = "64b000000000000000000001";
  const own = `${assetPrefix(cid)}q5.pdf`;

  console.log("\nWho can edit");
  check("company admin can edit", canEditCatalog({ role: "admin", companyId: cid }));
  check("legacy session with no role counts as admin", canEditCatalog({ companyId: cid }));
  check("agent cannot edit", !canEditCatalog({ role: "agent", companyId: cid }));
  check("super admin cannot edit (company admin only)", !canEditCatalog({ role: "super_admin" }));

  console.log("\nSave validation");
  const ok = cleanModelInput(
    {
      name: "  Q5 ",
      aliases: "q5 jun\nQ5\nq5 jun\nQ5 Remarketing",
      variants: [{ name: "Technology", exShowroomPrice: "65,99,000", onRoadPrice: "₹ 76,12,000", features: "Sunroof\n\nMatrix LED\nSunroof" }],
      colours: [{ name: "Navarra Blue", hex: "#1f3a93" }],
      files: [{ kind: "brochure", title: "Q5 brochure", url: own, fileId: "f1", size: 1234 }],
      imageUrl: `${assetPrefix(cid)}q5.jpg`,
      imageFileId: "f0",
    },
    cid
  );
  check("valid model passes", ok.errors.length === 0, ok.errors.join("; "));
  check("name is trimmed", ok.value.name === "Q5");
  check("prices with commas and ₹ are parsed to rupees", ok.value.variants[0].exShowroomPrice === 6599000 && ok.value.variants[0].onRoadPrice === 7612000);
  check("features split per line, blanks and repeats dropped", JSON.stringify(ok.value.variants[0].features) === '["Sunroof","Matrix LED"]');
  check("aliases de-duplicated and exclude the model name", JSON.stringify(ok.value.aliases) === '["q5 jun","Q5 Remarketing"]');
  check("on sale by default", ok.value.onSale === true);
  check("file ids collected for clean-up", JSON.stringify(fileIdsOf(ok.value).sort()) === '["f0","f1"]');

  check("name is required", cleanModelInput({ name: " " }, cid).errors.some((e) => /name is required/i.test(e)));
  check("variant needs a name", cleanModelInput({ name: "A4", variants: [{ exShowroomPrice: 1 }] }, cid).errors.some((e) => /Variant 1 needs a name/.test(e)));
  check("bad price rejected", cleanModelInput({ name: "A4", variants: [{ name: "X", exShowroomPrice: "abc" }] }, cid).errors.some((e) => /price/i.test(e)));
  check("blank price is allowed (stored as empty)", cleanModelInput({ name: "A4", variants: [{ name: "X", exShowroomPrice: "" }] }, cid).value.variants[0].exShowroomPrice === null);
  check(
    "a link from elsewhere is refused",
    cleanModelInput({ name: "A4", files: [{ title: "x", url: "https://evil.example/x.pdf" }] }, cid).errors.some((e) => /uploaded here/.test(e))
  );
  check(
    "another company's file is refused",
    cleanModelInput({ name: "A4", files: [{ title: "x", url: `${assetPrefix("64b000000000000000000002")}x.pdf` }] }, cid).errors.length > 0
  );
  check("invalid colour hex is dropped", cleanModelInput({ name: "A4", colours: [{ name: "Red", hex: "red;background:url(x)" }] }, cid).value.colours[0].hex === "");

  console.log("\nPrices and matching");
  check("full price uses Indian grouping", catalog.formatPrice(6599000).replace(/\s/g, "") === "₹65,99,000", catalog.formatPrice(6599000));
  check("short price in lakh", catalog.formatPriceShort(6599000) === "₹65.99 lakh", catalog.formatPriceShort(6599000));
  check("short price in crore", catalog.formatPriceShort(11200000) === "₹1.12 crore", catalog.formatPriceShort(11200000));
  check("starting price is the lowest variant", catalog.startingPrice({ variants: [{ exShowroomPrice: 9 }, { exShowroomPrice: 5 }, { exShowroomPrice: null }] }) === 5);
  const models = [{ name: "Q5", aliases: ["q5 jun", "Q5 Remarketing"] }, { name: "Q8 e-tron", aliases: [] }];
  check("matches by name, ignoring case and spaces", catalog.matchCatalogModel(models, "q 5")?.name === "Q5");
  check("matches a lead by an alias", catalog.matchCatalogModel(models, "", "Q5 jun")?.name === "Q5");
  check("matches punctuation-insensitively", catalog.matchCatalogModel(models, "Q8 etron")?.name === "Q8 e-tron");
  check("no match returns null", catalog.matchCatalogModel(models, "A6") === null);

  console.log("\nDatabase");
  const mongoose = require("mongoose");
  const connectDB = require("../lib/db");
  const Company = require("../models/Company");
  const CarModel = require("../models/CarModel");
  await connectDB();
  const company = await Company.create({ name: "__catalog-test__", slug: `catalog-test-${Date.now()}`, active: true });
  const other = await Company.create({ name: "__catalog-test-2__", slug: `catalog-test-2-${Date.now()}`, active: true });
  try {
    await CarModel.init();
    await CarModel.create({ companyId: company._id, name: "Q5" });
    let dup = false;
    try {
      await CarModel.create({ companyId: company._id, name: "q5" });
    } catch (err) {
      dup = err?.code === 11000;
    }
    check("same name twice in one company is refused (any case)", dup);
    const elsewhere = await CarModel.create({ companyId: other._id, name: "Q5" }).then(() => true, () => false);
    check("another company can use the same name", elsewhere);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    await CarModel.deleteMany({ companyId: { $in: [company._id, other._id] } });
    await Company.deleteMany({ _id: { $in: [company._id, other._id] } });
    await mongoose.disconnect();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
