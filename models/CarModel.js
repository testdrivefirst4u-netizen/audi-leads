const mongoose = require("mongoose");

// One car model a company sells, maintained by the company admin on the
// Models page (pages/catalog) so every agent — especially a new one — can
// look up variants, prices, specs, colours and brochures. Files live in
// ImageKit under /catalog/<companyId>/ (see pages/api/catalog/upload-auth.js);
// only their URLs and ImageKit file ids are stored here.

const VariantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // "Premium Plus 40 TFSI"
    exShowroomPrice: { type: Number, default: null }, // rupees
    onRoadPrice: { type: Number, default: null }, // rupees
    fuel: { type: String, default: "", trim: true }, // blank = model's fuel
    transmission: { type: String, default: "", trim: true },
    engine: { type: String, default: "", trim: true },
    power: { type: String, default: "", trim: true },
    torque: { type: String, default: "", trim: true },
    mileage: { type: String, default: "", trim: true },
    seats: { type: String, default: "", trim: true },
    features: { type: [String], default: [] },
  },
  { _id: true }
);

const ColourSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // "Navarra Blue"
    hex: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: "" },
    imageFileId: { type: String, default: "" },
  },
  { _id: true }
);

const FileSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["brochure", "price_list", "spec_sheet", "other"], default: "brochure" },
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    fileId: { type: String, default: "" },
    size: { type: Number, default: 0 }, // bytes
    mimeType: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Extra photos of a model: what a customer asks to see beyond the main shot.
const GalleryImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    fileId: { type: String, default: "" },
    kind: { type: String, enum: ["exterior", "interior", "detail"], default: "exterior" },
    caption: { type: String, default: "", trim: true },
  },
  { _id: true }
);

// A spec that applies to the model as a whole (dimensions, boot space,
// safety kit…), grouped for display. Per-variant numbers stay on variants.
const SpecSchema = new mongoose.Schema(
  {
    group: { type: String, default: "General", trim: true }, // Dimensions, Safety, Comfort, Tech…
    name: { type: String, required: true, trim: true }, // "Boot space"
    value: { type: String, required: true, trim: true }, // "520 litres"
  },
  { _id: true }
);

// A ready answer to a question customers often ask on the phone.
const FaqSchema = new mongoose.Schema(
  {
    q: { type: String, required: true, trim: true },
    a: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const CarModelSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true }, // "Q5"
    tagline: { type: String, default: "", trim: true },
    bodyType: { type: String, default: "", trim: true }, // SUV, Sedan…
    fuel: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    imageFileId: { type: String, default: "" },
    // Other names leads arrive with for this car ("q5 jun", "Q5 Remarketing"),
    // so a lead's model can be matched to this entry.
    aliases: { type: [String], default: [] },
    onSale: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    variants: { type: [VariantSchema], default: [] },
    colours: { type: [ColourSchema], default: [] },
    files: { type: [FileSchema], default: [] },
    // What telecallers need on a call (the lead window's Car panel).
    gallery: { type: [GalleryImageSchema], default: [] },
    highlights: { type: [String], default: [] }, // 5–6 short selling points
    specs: { type: [SpecSchema], default: [] },
    faqs: { type: [FaqSchema], default: [] },
    // Prices are only as good as their date: shown beside every price, and
    // older than 30 days → "check with sales" (lib/catalog.js isPriceStale).
    priceAsOf: { type: Date, default: null },
    priceCity: { type: String, default: "", trim: true }, // on-road prices differ by city
    offers: { type: String, default: "", trim: true }, // this dealer's current offer, free text
    sourceNote: { type: String, default: "", trim: true }, // where the data came from
    // Copied from another dealer's catalog (pages/api/catalog/copy.js) — the
    // source model, so a later copy updates it instead of adding a second one.
    copiedFrom: {
      companyId: { type: mongoose.Schema.Types.ObjectId, default: null },
      modelId: { type: mongoose.Schema.Types.ObjectId, default: null },
      at: { type: Date, default: null },
      // source file id → this company's copy, so copying again reuses photos
      // and brochures that haven't changed instead of uploading them twice
      assets: { type: [{ source: String, url: String, fileId: String, _id: false }], default: [] },
    },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

CarModelSchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.models.CarModel || mongoose.model("CarModel", CarModelSchema);
