const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    logoUrl: { type: String, default: "" },
    // Hex color, e.g. "#3d5afe" — blank means use the platform default blue.
    // Hover/soft tints are derived from this one value at render time
    // (see lib/color.js), not stored separately.
    brandColor: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Company || mongoose.model("Company", CompanySchema);
