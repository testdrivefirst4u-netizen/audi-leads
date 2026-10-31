// Validates and normalises a car-catalog save (pages/api/catalog) and cleans
// up files that a save removed. Plain CommonJS so scripts/test-catalog.js can
// load it without Next's compiler.

// The catalog is read by everyone in the company; the company's own admin
// and the super admin edit it — the super admin only once a company has been
// chosen (?companyId=, which lib/auth.js's scopeSuperAdminToCompany turns
// into session.companyId). Agents only view. Sessions issued before agent
// accounts existed have no role — treated as admin, matching requireAdmin.
function canEditCatalog(session) {
  if (!session || !session.companyId) return false;
  return session.role === "super_admin" || session.role === "admin" || !session.role;
}

const LIMITS = { name: 80, text: 200, description: 4000, variants: 60, colours: 40, files: 30, features: 60, aliases: 20, gallery: 24, highlights: 8, specs: 150, faqs: 40, answer: 1000 };
const GALLERY_KINDS = ["exterior", "interior", "detail"];
const FILE_KINDS = ["brochure", "price_list", "spec_sheet", "other"];

// Every image/file must already live in this company's ImageKit folder —
// never an arbitrary link (which could point anywhere) or another company's file.
function companyFolder(companyId) {
  return `/catalog/${companyId}/`;
}

function assetPrefix(companyId) {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/+$/, "");
  return `${endpoint}${companyFolder(companyId)}`;
}

function str(v, max = LIMITS.text) {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

// "46,99,000" / "4699000" / 4699000 → 4699000; blank → null.
function price(v, label, errors) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1e10) {
    errors.push(`${label} must be a price in rupees`);
    return null;
  }
  return Math.round(n);
}

function list(v, max, maxLen = LIMITS.text) {
  const arr = Array.isArray(v) ? v : String(v || "").split(/\r?\n/);
  return [...new Set(arr.map((x) => str(x, maxLen)).filter(Boolean))].slice(0, max);
}

function asset(url, companyId, label, errors) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (!u.startsWith(assetPrefix(companyId))) {
    errors.push(`${label} must be uploaded here, not linked from elsewhere`);
    return "";
  }
  return u;
}

function cleanModelInput(body, companyId) {
  const b = body || {};
  const errors = [];
  const name = str(b.name, LIMITS.name);
  if (!name) errors.push("Model name is required");

  const variants = (Array.isArray(b.variants) ? b.variants : []).slice(0, LIMITS.variants).map((v, i) => {
    const vName = str(v?.name, LIMITS.name);
    if (!vName) errors.push(`Variant ${i + 1} needs a name`);
    const out = {
      name: vName,
      exShowroomPrice: price(v?.exShowroomPrice, `${vName || `Variant ${i + 1}`} ex-showroom price`, errors),
      onRoadPrice: price(v?.onRoadPrice, `${vName || `Variant ${i + 1}`} on-road price`, errors),
      fuel: str(v?.fuel),
      transmission: str(v?.transmission),
      engine: str(v?.engine),
      power: str(v?.power),
      torque: str(v?.torque),
      mileage: str(v?.mileage),
      seats: str(v?.seats),
      features: list(v?.features, LIMITS.features),
    };
    if (v?._id) out._id = String(v._id);
    return out;
  });

  const colours = (Array.isArray(b.colours) ? b.colours : []).slice(0, LIMITS.colours).map((c, i) => {
    const cName = str(c?.name, LIMITS.name);
    if (!cName) errors.push(`Colour ${i + 1} needs a name`);
    const hex = str(c?.hex, 9);
    const out = {
      name: cName,
      hex: /^#[0-9a-f]{3,8}$/i.test(hex) ? hex : "",
      imageUrl: asset(c?.imageUrl, companyId, `${cName || "Colour"} photo`, errors),
      imageFileId: str(c?.imageFileId, 100),
    };
    if (c?._id) out._id = String(c._id);
    return out;
  });

  const files = (Array.isArray(b.files) ? b.files : []).slice(0, LIMITS.files).map((f, i) => {
    const url = asset(f?.url, companyId, `File ${i + 1}`, errors);
    if (!url) errors.push(`File ${i + 1} has no uploaded file`);
    const out = {
      kind: FILE_KINDS.includes(f?.kind) ? f.kind : "other",
      title: str(f?.title, LIMITS.name) || "Brochure",
      url,
      fileId: str(f?.fileId, 100),
      size: Math.max(0, Number(f?.size) || 0),
      mimeType: str(f?.mimeType, 100),
      uploadedAt: f?.uploadedAt ? new Date(f.uploadedAt) : new Date(),
    };
    if (f?._id) out._id = String(f._id);
    return out;
  });

  const gallery = (Array.isArray(b.gallery) ? b.gallery : []).slice(0, LIMITS.gallery).map((g, i) => {
    const url = asset(g?.url, companyId, `Gallery photo ${i + 1}`, errors);
    if (!url) errors.push(`Gallery photo ${i + 1} has no uploaded image`);
    const out = { url, fileId: str(g?.fileId, 100), kind: GALLERY_KINDS.includes(g?.kind) ? g.kind : "exterior", caption: str(g?.caption) };
    if (g?._id) out._id = String(g._id);
    return out;
  });

  const specs = (Array.isArray(b.specs) ? b.specs : [])
    .slice(0, LIMITS.specs)
    .map((sp) => ({ group: str(sp?.group, LIMITS.name) || "General", name: str(sp?.name, LIMITS.name), value: str(sp?.value) }))
    .filter((sp) => sp.name && sp.value);

  const faqs = (Array.isArray(b.faqs) ? b.faqs : [])
    .slice(0, LIMITS.faqs)
    .map((f) => ({ q: str(f?.q), a: str(f?.a, LIMITS.answer) }))
    .filter((f) => f.q && f.a);

  let priceAsOf = null;
  if (b.priceAsOf) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(b.priceAsOf)) ? `${b.priceAsOf}T12:00:00Z` : b.priceAsOf);
    if (Number.isNaN(d.getTime())) errors.push("Price date isn't a valid date");
    else priceAsOf = d;
  }

  const value = {
    name,
    tagline: str(b.tagline),
    bodyType: str(b.bodyType),
    fuel: str(b.fuel),
    description: str(b.description, LIMITS.description),
    imageUrl: asset(b.imageUrl, companyId, "Model photo", errors),
    imageFileId: str(b.imageFileId, 100),
    aliases: list(b.aliases, LIMITS.aliases, LIMITS.name).filter((a) => a.toLowerCase() !== name.toLowerCase()),
    onSale: b.onSale === undefined ? true : Boolean(b.onSale),
    sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
    variants,
    colours,
    files,
    gallery,
    highlights: list(b.highlights, LIMITS.highlights),
    specs,
    faqs,
    priceAsOf,
    priceCity: str(b.priceCity, LIMITS.name),
    offers: str(b.offers, LIMITS.answer),
    sourceNote: str(b.sourceNote),
  };
  return { value, errors };
}

// ImageKit file ids referenced by a model (photo, colour photos, files).
function fileIdsOf(model) {
  if (!model) return [];
  return [model.imageFileId, ...(model.colours || []).map((c) => c.imageFileId), ...(model.files || []).map((f) => f.fileId), ...(model.gallery || []).map((g) => g.fileId)].filter(Boolean);
}

// Best-effort removal of files a save or delete dropped. Each id is checked to
// really sit in this company's folder before deleting, so a crafted id can't
// remove someone else's file. Failures are logged, never thrown.
async function deleteCatalogFiles(companyId, fileIds) {
  if (!fileIds.length || !process.env.IMAGEKIT_PRIVATE_KEY) return;
  const { getImageKit } = require("./imagekit");
  const ik = getImageKit();
  await Promise.all(
    [...new Set(fileIds)].map(async (id) => {
      try {
        const details = await ik.getFileDetails(id);
        if (!String(details?.filePath || "").startsWith(companyFolder(companyId))) return;
        await ik.deleteFile(id);
      } catch (err) {
        console.warn("[catalog] could not delete file", id, err?.message || err);
      }
    })
  );
}

module.exports = { canEditCatalog, cleanModelInput, fileIdsOf, deleteCatalogFiles, companyFolder, assetPrefix, LIMITS };
