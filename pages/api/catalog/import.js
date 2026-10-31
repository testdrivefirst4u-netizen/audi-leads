const connectDB = require("../../../lib/db");
const CarModel = require("../../../models/CarModel");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { canEditCatalog } = require("../../../lib/catalogInput");
const { planImport } = require("../../../lib/catalogImport");

// Spreadsheet import for the Models catalog (pages/catalog/import.js). The
// browser reads the .xlsx and sends its sheets as rows; this plans the
// changes (lib/catalogImport.js) and, with apply:true, saves them.
// apply:false is the preview: nothing is written.
//
// The super admin imports into the company picked on the Models page (?companyId=).
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!canEditCatalog(req.session)) return res.status(403).json({ error: "Only an admin can import the catalog" });
  const { sheets, apply } = req.body || {};
  if (!sheets || typeof sheets !== "object") return res.status(400).json({ error: "No spreadsheet rows were sent" });

  await connectDB();
  const { companyId } = req.session;
  const existing = await CarModel.find({ companyId }).lean();
  const { plan, warnings } = planImport(existing, sheets, companyId);
  const summary = plan.map(({ name, action, changes, errors }) => ({ name, action, changes, errors }));

  if (!apply) return res.status(200).json({ plan: summary, warnings });
  if (plan.some((p) => p.errors.length)) {
    return res.status(400).json({ error: "Fix the rows marked in the preview first", plan: summary, warnings });
  }

  const by = req.session.username || "";
  for (const p of plan) {
    if (p.action === "create") await CarModel.create({ ...p.value, companyId, updatedBy: by });
    else await CarModel.updateOne({ _id: p.modelId, companyId }, { $set: { ...p.value, updatedBy: by } }, { runValidators: true });
  }
  return res.status(200).json({ applied: true, plan: summary, warnings });
}

export default requireCompanyMemberOrSuperAdmin(handler);
