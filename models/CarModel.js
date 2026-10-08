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
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

CarModelSchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.models.CarModel || mongoose.model("CarModel", CarModelSchema);
