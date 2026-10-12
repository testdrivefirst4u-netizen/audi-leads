const connectDB = require("../../../lib/db");
const CarModel = require("../../../models/CarModel");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { canEditCatalog, cleanModelInput } = require("../../../lib/catalogInput");

async function handler(req, res) {
  await connectDB();
  const { companyId } = req.session;
  const canEdit = canEditCatalog(req.session);

  if (req.method === "GET") {
    // Agents only see cars on sale; whoever manages the catalog sees all.
    const filter = { companyId };
    if (!canEdit) filter.onSale = true;
    const models = await CarModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    return res.status(200).json({ models, canEdit });
  }

  if (req.method === "POST") {
    if (!canEdit) return res.status(403).json({ error: "Only an admin can edit the catalog" });
    const { value, errors } = cleanModelInput(req.body, companyId);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    try {
      const model = await CarModel.create({ ...value, companyId, updatedBy: req.session.username || "" });
      return res.status(201).json({ model });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: `A model called "${value.name}" already exists` });
      throw err;
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdmin(handler);
