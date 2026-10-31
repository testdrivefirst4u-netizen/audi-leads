const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const CarModel = require("../../../models/CarModel");
const Company = require("../../../models/Company");
const { requireSuperAdmin } = require("../../../lib/auth");
const { cleanModelInput, companyFolder, fileIdsOf, deleteCatalogFiles } = require("../../../lib/catalogInput");

// "Copy models from another dealer" (super admin, Models page): enter a
// brand's line-up once in one dealer's catalog, then copy it to the brand's
// other dealers. Copying again updates the earlier copies.
//
// What comes from the source: names, descriptions, highlights, specs, quick
// answers, variants with their specs and ex-showroom prices, colours, photos
// and brochures. What the target dealer keeps: its on-road prices (per
// variant, matched by name), price city, offers, on-sale flag, order, and any
// photos or brochures it uploaded itself.
//
// Every catalog file must live in the company's own storage folder
// (lib/catalogInput.js), so photos and brochures are copied into the target's
// folder; a file already copied earlier (same source file) is reused.
//
// POST { fromCompanyId, toCompanyId, apply } — apply:false previews.

const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

async function copyAsset(url, sourceFileId, targetCompanyId, reuse, uploads) {
  if (!url) return { url: "", fileId: "" };
  const known = reuse.find((a) => a.source === (sourceFileId || url));
  if (known) return { url: known.url, fileId: known.fileId };
  const { getImageKit } = require("../../../lib/imagekit");
  const fileName = decodeURIComponent(String(url).split("?")[0].split("/").pop() || "file");
  const r = await getImageKit().upload({ file: url, fileName, folder: companyFolder(targetCompanyId), useUniqueFileName: true });
  const out = { url: r.url, fileId: r.fileId };
  uploads.push({ source: sourceFileId || url, ...out });
  return out;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { fromCompanyId, toCompanyId, apply } = req.body || {};
  if (!mongoose.isValidObjectId(fromCompanyId) || !mongoose.isValidObjectId(toCompanyId)) return res.status(400).json({ error: "Pick both dealers" });
  if (String(fromCompanyId) === String(toCompanyId)) return res.status(400).json({ error: "Pick a different dealer to copy from" });

  await connectDB();
  const [from, to] = await Promise.all([Company.findById(fromCompanyId).select("name").lean(), Company.findById(toCompanyId).select("name").lean()]);
  if (!from || !to) return res.status(404).json({ error: "Dealer not found" });

  const [source, target] = await Promise.all([CarModel.find({ companyId: fromCompanyId }).sort({ sortOrder: 1, name: 1 }).lean(), CarModel.find({ companyId: toCompanyId }).lean()]);
  const findTarget = (m) => target.find((t) => String(t.copiedFrom?.modelId || "") === String(m._id)) || target.find((t) => key(t.name) === key(m.name));

  const plan = source.map((m) => {
    const t = findTarget(m);
    return { name: m.name, action: t ? "update" : "create", variants: (m.variants || []).length, photos: 1 + (m.gallery || []).length + (m.colours || []).filter((c) => c.imageUrl).length, files: (m.files || []).length };
  });
  if (!apply) return res.status(200).json({ from: from.name, to: to.name, plan });

  if (!process.env.IMAGEKIT_PRIVATE_KEY) return res.status(503).json({ error: "File storage isn't configured on this server" });

  const done = [];
  for (const m of source) {
    const t = findTarget(m);
    const reuse = t?.copiedFrom?.assets || [];
    const uploads = [];
    const cp = (url, fileId) => copyAsset(url, fileId, toCompanyId, reuse, uploads);

    const image = await cp(m.imageUrl, m.imageFileId);
    const gallery = [];
    for (const g of m.gallery || []) gallery.push({ kind: g.kind, caption: g.caption, ...(await cp(g.url, g.fileId)) });
    const colours = [];
    for (const c of m.colours || []) {
      const img = await cp(c.imageUrl, c.imageFileId);
      colours.push({ name: c.name, hex: c.hex, imageUrl: img.url, imageFileId: img.fileId });
    }
    const files = [];
    for (const f of m.files || []) {
      const copied = await cp(f.url, f.fileId);
      files.push({ kind: f.kind, title: f.title, size: f.size, mimeType: f.mimeType, uploadedAt: f.uploadedAt, url: copied.url, fileId: copied.fileId });
    }
    // Photos and brochures the target dealer uploaded itself (not from an
    // earlier copy) stay, after the copied ones.
    const fromEarlierCopy = (fileId) => reuse.some((a) => a.fileId === fileId);
    for (const g of t?.gallery || []) if (!fromEarlierCopy(g.fileId)) gallery.push({ kind: g.kind, caption: g.caption, url: g.url, fileId: g.fileId });
    for (const f of t?.files || []) if (!fromEarlierCopy(f.fileId)) files.push({ kind: f.kind, title: f.title, size: f.size, mimeType: f.mimeType, uploadedAt: f.uploadedAt, url: f.url, fileId: f.fileId });

    // on-road prices are the target dealer's own (they differ by city)
    const ownOnRoad = new Map((t?.variants || []).map((v) => [key(v.name), v.onRoadPrice]));
    const variants = (m.variants || []).map(({ _id, ...v }) => ({ ...v, onRoadPrice: ownOnRoad.has(key(v.name)) ? ownOnRoad.get(key(v.name)) : null }));

    const input = {
      name: m.name,
      tagline: m.tagline,
      bodyType: m.bodyType,
      fuel: m.fuel,
      description: m.description,
      aliases: m.aliases,
      highlights: m.highlights,
      specs: m.specs,
      faqs: m.faqs,
      sourceNote: m.sourceNote,
      priceAsOf: m.priceAsOf,
      variants,
      colours,
      files,
      gallery,
      imageUrl: image.url,
      imageFileId: image.fileId,
      // the target's own settings
      onSale: t ? t.onSale : m.onSale,
      sortOrder: t ? t.sortOrder : m.sortOrder,
      offers: t?.offers || "",
      priceCity: t?.priceCity || "",
    };
    const { value, errors } = cleanModelInput(input, toCompanyId);
    if (errors.length) return res.status(400).json({ error: `${m.name}: ${errors[0]}`, done });

    const keptAssets = [...reuse, ...uploads].filter((a) => fileIdsOf(value).includes(a.fileId));
    const copiedFrom = { companyId: fromCompanyId, modelId: m._id, at: new Date(), assets: keptAssets };
    const by = req.session.username || "";
    if (t) {
      await CarModel.updateOne({ _id: t._id, companyId: toCompanyId }, { $set: { ...value, copiedFrom, updatedBy: by } }, { runValidators: true });
      // files the earlier copy had and this one no longer uses
      const kept = new Set(fileIdsOf(value));
      deleteCatalogFiles(toCompanyId, fileIdsOf(t).filter((f) => !kept.has(f)));
    } else {
      await CarModel.create({ ...value, copiedFrom, companyId: toCompanyId, updatedBy: by });
    }
    done.push(m.name);
  }
  return res.status(200).json({ applied: true, from: from.name, to: to.name, copied: done });
}

export default requireSuperAdmin(handler);
