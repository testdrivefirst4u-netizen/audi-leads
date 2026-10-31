// Top-bar search over the Models catalog (components/GlobalSearch.js): finds
// the car named in the search and, from the rest of the words, the spec,
// quick answer or variant price being asked about — "q7 boot space" →
// "Q7 · Boot space: 520 litres".
import { apiFetch } from "./apiFetch";
import { formatPriceShort, startingPrice } from "./catalog";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let catalogPromise = null;
export function loadCatalogForSearch() {
  if (!catalogPromise) {
    catalogPromise = apiFetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => d.models || [])
      .catch(() => {
        catalogPromise = null;
        return [];
      });
  }
  return catalogPromise;
}

const MAX = 4;

// → [{ modelId, title, detail }]
export function searchCars(models, term) {
  const q = norm(term);
  if (q.length < 2) return [];
  const results = [];
  for (const m of models || []) {
    const names = [m.name, ...(m.aliases || [])].map(norm).filter(Boolean);
    const named = names.find((n) => q === n || q.startsWith(`${n} `) || q.endsWith(` ${n}`) || q.includes(` ${n} `));
    if (!named) {
      // just a model name being typed ("q", "q7")
      if (names.some((n) => n.startsWith(q))) results.push({ modelId: m._id, title: m.name, detail: [m.bodyType, `from ${formatPriceShort(startingPrice(m, "exShowroomPrice"))}`].filter(Boolean).join(" · ") });
      continue;
    }
    const rest = q.replace(named, " ").replace(/\s+/g, " ").trim();
    if (!rest) {
      results.push({ modelId: m._id, title: m.name, detail: [m.bodyType, `from ${formatPriceShort(startingPrice(m, "exShowroomPrice"))}`, `${(m.variants || []).length} variants`].filter(Boolean).join(" · ") });
      continue;
    }
    const words = rest.split(" ").filter((w) => w.length > 1);
    const hits = (text) => words.every((w) => norm(text).includes(w));
    for (const s of m.specs || []) if (hits(`${s.group} ${s.name}`)) results.push({ modelId: m._id, title: `${m.name} · ${s.name}`, detail: s.value });
    for (const f of m.faqs || []) if (hits(f.q)) results.push({ modelId: m._id, title: `${m.name} · ${f.q}`, detail: f.a });
    for (const v of m.variants || []) {
      if (hits(v.name) || (/price|cost|on road|onroad/.test(rest) && words.some((w) => norm(v.name).includes(w)))) {
        results.push({ modelId: m._id, title: `${m.name} ${v.name}`, detail: `Ex ${formatPriceShort(v.exShowroomPrice)} · On-road ${formatPriceShort(v.onRoadPrice)}` });
      }
    }
    if (/price|cost/.test(rest) && !results.some((r) => String(r.modelId) === String(m._id))) {
      results.push({ modelId: m._id, title: `${m.name} price`, detail: `from ${formatPriceShort(startingPrice(m, "exShowroomPrice"))} ex-showroom` });
    }
  }
  return results.slice(0, MAX);
}
