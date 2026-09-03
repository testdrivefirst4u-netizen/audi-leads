const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    // Absent/null = super admin (platform owner, manages Companies).
    // Present = a company admin, scoped to that one company.
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    // Personal avatar (super admin's self-service Account page) — distinct
    // from a company's own logoUrl on the Company model.
    avatarUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Admin || mongoose.model("Admin", AdminSchema);
