const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const CarModel = require("../../../models/CarModel");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { canEditCatalog, cleanModelInput, fileIdsOf, deleteCatalogFiles } = require("../../../lib/catalogInput");

async function handler(req, res) {
  await connectDB();
  const { companyId } = req.session;
  const { id } = req.query;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "Model not found" });
  const canEdit = canEditCatalog(req.session);

  const existing = await CarModel.findOne({ _id: id, companyId }).lean();
  if (!existing || (!existing.onSale && !canEdit && req.session.role !== "super_admin")) {
    return res.status(404).json({ error: "Model not found" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ model: existing, canEdit });
  }

  if (!canEdit) return res.status(403).json({ error: "Only the company admin can edit the catalog" });

  if (req.method === "PUT") {
    const { value, errors } = cleanModelInput(req.body, companyId);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    let model;
    try {
      model = await CarModel.findOneAndUpdate(
        { _id: id, companyId },
        { $set: { ...value, updatedBy: req.session.username || "" } },
        { new: true, runValidators: true }
      ).lean();
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: `A model called "${value.name}" already exists` });
      throw err;
    }
    // Files the edit dropped (a replaced photo, a removed brochure).
    const kept = new Set(fileIdsOf(model));
    deleteCatalogFiles(companyId, fileIdsOf(existing).filter((f) => !kept.has(f)));
    return res.status(200).json({ model });
  }

  if (req.method === "DELETE") {
    await CarModel.deleteOne({ _id: id, companyId });
    deleteCatalogFiles(companyId, fileIdsOf(existing));
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdmin(handler);
