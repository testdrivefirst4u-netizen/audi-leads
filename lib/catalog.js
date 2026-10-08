// Client-safe helpers for the car catalog (models/CarModel.js) — shared by
// the Models pages, the editor, the lead modal's "About this car" box and
// the API's input validation.

export const BODY_TYPES = ["SUV", "Sedan", "Hatchback", "Coupe", "Convertible", "Estate", "MPV", "Pickup"];
export const FUEL_TYPES = ["Petrol", "Diesel", "Electric", "Hybrid", "Plug-in Hybrid", "CNG"];
export const TRANSMISSIONS = ["Automatic", "Manual", "DCT", "CVT"];

export const FILE_KINDS = [
  { value: "brochure", label: "Brochure" },
  { value: "price_list", label: "Price list" },
  { value: "spec_sheet", label: "Spec sheet" },
  { value: "other", label: "Other" },
];

export function fileKindLabel(kind) {
  return FILE_KINDS.find((k) => k.value === kind)?.label || "File";
}

// Upload limits — enforced in the browser before uploading, and the API only
// accepts files that landed in the company's own ImageKit folder.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const DOCUMENT_TYPES = ["application/pdf", ...IMAGE_TYPES];

// ₹46,99,000 — Indian digit grouping, no paise.
export function formatPrice(rupees) {
  if (rupees == null || Number.isNaN(Number(rupees))) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(rupees));
}

// ₹46.99 lakh / ₹1.12 crore — how prices are spoken on the showroom floor.
export function formatPriceShort(rupees) {
  const n = Number(rupees);
  if (rupees == null || Number.isNaN(n) || n <= 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} crore`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, "")} lakh`;
  return formatPrice(n);
}

export function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Lowest price across a model's variants, for "from ₹…" on cards.
export function startingPrice(model, field = "exShowroomPrice") {
  const prices = (model?.variants || []).map((v) => v[field]).filter((p) => p != null && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Finds the catalog entry for a lead's model: an exact name/alias match on
// the canonical model first, then on the raw sheet/form model value.
export function matchCatalogModel(models, ...candidates) {
  const wanted = candidates.map(norm).filter(Boolean);
  for (const w of wanted) {
    const hit = (models || []).find((m) => norm(m.name) === w || (m.aliases || []).some((a) => norm(a) === w));
    if (hit) return hit;
  }
  return null;
}
