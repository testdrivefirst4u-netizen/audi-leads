// Turns an uploaded catalog spreadsheet into model saves (pages/api/catalog/import.js).
// Plain CommonJS so scripts can load it without Next's compiler.
//
// Sheets (any can be missing; column names are matched loosely, so "Ex-showroom
// price (Rs)" and "exShowroomPrice" both work):
//   Models         — model, tagline, body type, fuel, description, highlights, aliases, offers
//   Variants       — model, variant, ex-showroom price, on-road price, price city, price date,
//                    fuel, transmission, engine, power, torque, mileage, seats, features
//   Specs          — model, variant (optional), group, name, value
//   Colours        — model, colour, hex
//   Quick answers  — model, question, answer
//
// Matching is by name, ignoring case and spacing: a model by its name (or an
// alias), a variant within its model by name, a colour by name. So importing
// a newer price list updates what's there instead of adding duplicates.
// Specs and quick answers for a model are replaced by the sheet's rows when
// the sheet has any for that model. Photos and brochures are not in the
// sheet — they're uploaded in the model editor.

const { cleanModelInput } = require("./catalogInput");

const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const text = (v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const splitList = (v) =>
  text(v)
    .split(/\r?\n|\|/)
    .map((x) => x.trim())
    .filter(Boolean);

// Column name → field, by loose match on the header.
const COLUMNS = {
  model: ["model", "modelname", "car"],
  name: ["name", "spec", "specname"],
  variant: ["variant", "variantname", "trim"],
  tagline: ["tagline"],
  bodyType: ["bodytype", "body", "type"],
  fuel: ["fuel", "fueltype"],
  description: ["description", "about"],
  highlights: ["highlights", "keyhighlights", "sellingpoints"],
  aliases: ["aliases", "alsocalled", "othernames"],
  offers: ["offers", "offer", "currentoffer"],
  exShowroomPrice: ["exshowroomprice", "exshowroom", "exshowroompricers", "exshowroompriceinr"],
  onRoadPrice: ["onroadprice", "onroad", "onroadpricers", "onroadpriceinr"],
  priceCity: ["pricecity", "city"],
  priceAsOf: ["pricedate", "priceasof", "pricesasof", "date"],
  transmission: ["transmission", "gearbox"],
  engine: ["engine"],
  power: ["power", "maxpower"],
  torque: ["torque", "maxtorque"],
  mileage: ["mileage", "fe", "fueleconomy", "range"],
  seats: ["seats", "seating", "seatingcapacity"],
  features: ["features", "keyfeatures"],
  group: ["group", "category", "section"],
  value: ["value"],
  colour: ["colour", "color", "colourname", "colorname"],
  hex: ["hex", "hexcode", "colourcode", "colorcode"],
  question: ["question", "q"],
  answer: ["answer", "a"],
};

function normaliseRow(row) {
  const out = {};
  for (const [header, value] of Object.entries(row || {})) {
    const k = key(header);
    for (const [field, names] of Object.entries(COLUMNS)) {
      if (names.includes(k) && out[field] === undefined) out[field] = value;
    }
  }
  return out;
}

function sheetRows(sheets, ...names) {
  const wanted = names.map(key);
  const found = Object.entries(sheets || {}).find(([n]) => wanted.includes(key(n)));
  return (found ? found[1] : []).map(normaliseRow);
}

// The editor/API shape of a stored model, so an import can be merged into it.
function asInput(m) {
  return {
    ...m,
    variants: (m.variants || []).map((v) => ({ ...v })),
    colours: (m.colours || []).map((c) => ({ ...c })),
    files: m.files || [],
    gallery: m.gallery || [],
    highlights: m.highlights || [],
    specs: m.specs || [],
    faqs: m.faqs || [],
    aliases: m.aliases || [],
  };
}

/**
 * existing: the company's stored models (lean). sheets: { "<sheet name>": [rowObject, …] }.
 * → { plan: [{ name, action: "create"|"update", modelId?, value, changes: [..], errors: [..] }], warnings: [..] }
 */
function planImport(existing, sheets, companyId) {
  const warnings = [];
  const byName = new Map();
  for (const m of existing || []) {
    byName.set(key(m.name), m);
    for (const a of m.aliases || []) if (!byName.has(key(a))) byName.set(key(a), m);
  }
  const work = new Map(); // model key → { stored, value, changes:Set }
  const modelFor = (rawName, sheet, rowNo) => {
    const name = text(rawName);
    if (!name) {
      warnings.push(`${sheet} row ${rowNo}: no model name, skipped`);
      return null;
    }
    const k = key(name);
    const stored = byName.get(k);
    const wk = stored ? `id:${stored._id}` : `new:${k}`;
    if (!work.has(wk)) {
      work.set(wk, { stored, value: stored ? asInput(stored) : asInput({ name, onSale: true }), changes: [] });
    }
    return work.get(wk);
  };

  sheetRows(sheets, "Models").forEach((r, i) => {
    const w = modelFor(r.model ?? r.name, "Models", i + 2);
    if (!w) return;
    for (const f of ["tagline", "bodyType", "fuel", "description", "offers"]) {
      if (text(r[f]) && text(r[f]) !== text(w.value[f])) {
        w.value[f] = text(r[f]);
        w.changes.push(`${f === "bodyType" ? "body type" : f} set`);
      }
    }
    if (text(r.highlights)) {
      w.value.highlights = splitList(r.highlights);
      w.changes.push(`${w.value.highlights.length} highlights`);
    }
    if (text(r.aliases)) w.value.aliases = splitList(r.aliases);
  });

  sheetRows(sheets, "Variants").forEach((r, i) => {
    const w = modelFor(r.model, "Variants", i + 2);
    if (!w) return;
    const vName = text(r.variant ?? r.name);
    if (!vName) {
      warnings.push(`Variants row ${i + 2}: no variant name, skipped`);
      return;
    }
    let v = w.value.variants.find((x) => key(x.name) === key(vName));
    if (!v) {
      v = { name: vName, features: [] };
      w.value.variants.push(v);
      w.changes.push(`variant ${vName} added`);
    }
    let priceChanged = false;
    for (const f of ["exShowroomPrice", "onRoadPrice"]) {
      if (text(r[f])) {
        const before = v[f] == null ? "" : String(v[f]);
        v[f] = text(r[f]);
        if (before !== String(Number(String(v[f]).replace(/[₹,\s]/g, "")))) priceChanged = true;
      }
    }
    if (priceChanged && w.stored?.variants?.some((x) => key(x.name) === key(vName))) w.changes.push(`${v.name} price updated`);
    for (const f of ["fuel", "transmission", "engine", "power", "torque", "mileage", "seats"]) if (text(r[f])) v[f] = text(r[f]);
    if (text(r.features)) v.features = splitList(r.features);
    if (text(r.priceCity)) w.value.priceCity = text(r.priceCity);
    if (text(r.priceAsOf)) w.value.priceAsOf = text(r.priceAsOf);
  });

  const specsByModel = new Map();
  sheetRows(sheets, "Specs", "Specifications").forEach((r, i) => {
    const w = modelFor(r.model, "Specs", i + 2);
    if (!w) return;
    const name = text(r.name);
    if (!name || !text(r.value)) return;
    if (!specsByModel.has(w)) specsByModel.set(w, []);
    specsByModel.get(w).push({ group: text(r.group) || "General", name: text(r.variant) ? `${name} (${text(r.variant)})` : name, value: text(r.value) });
  });
  for (const [w, specs] of specsByModel) {
    w.value.specs = specs;
    w.changes.push(`${specs.length} specs`);
  }

  sheetRows(sheets, "Colours", "Colors").forEach((r, i) => {
    const w = modelFor(r.model, "Colours", i + 2);
    if (!w) return;
    const name = text(r.colour ?? r.name);
    if (!name) return;
    let c = w.value.colours.find((x) => key(x.name) === key(name));
    if (!c) {
      c = { name, hex: "", imageUrl: "", imageFileId: "" };
      w.value.colours.push(c);
      w.changes.push(`colour ${name} added`);
    }
    const hex = text(r.hex);
    if (hex) c.hex = hex.startsWith("#") ? hex : `#${hex}`;
  });

  const faqsByModel = new Map();
  sheetRows(sheets, "Quick answers", "FAQs", "FAQ").forEach((r, i) => {
    const w = modelFor(r.model, "Quick answers", i + 2);
    if (!w) return;
    if (!text(r.question) || !text(r.answer)) return;
    if (!faqsByModel.has(w)) faqsByModel.set(w, []);
    faqsByModel.get(w).push({ q: text(r.question), a: text(r.answer) });
  });
  for (const [w, faqs] of faqsByModel) {
    w.value.faqs = faqs;
    w.changes.push(`${faqs.length} quick answers`);
  }

  const plan = [...work.values()].map((w) => {
    const { value, errors } = cleanModelInput(w.value, companyId);
    return {
      name: value.name,
      action: w.stored ? "update" : "create",
      modelId: w.stored ? String(w.stored._id) : undefined,
      value,
      changes: w.changes.length ? [...new Set(w.changes)] : ["no changes"],
      errors,
    };
  });
  return { plan, warnings };
}

module.exports = { planImport };
