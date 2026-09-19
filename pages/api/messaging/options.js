const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const Agent = require("../../../models/Agent");
const Settings = require("../../../models/Settings");
const { requireAdminOrSuperAdmin } = require("../../../lib/auth");
const { effectiveStatuses } = require("../../../lib/leadFields");
const { BUCKETS } = require("../../../models/Lead");

// Filter vocabulary for the campaign audience builder — the same lists the
// Leads page offers (models, statuses, sources, locations, platforms,
// agents) plus channel readiness counts so the wizard can say how many
// leads have a phone / email at all.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();
  const companyId = req.session.companyId;
  const settings = await Settings.findOne({ companyId }).select("statusOptions sourceOptions locationField locationOptions").lean();
  const [models, sources, locations, platforms, agents, withPhone, withEmail, waOptOut, emailOptOut] = await Promise.all([
    Lead.distinct("canonicalModel", { companyId }),
    settings?.sourceOptions?.length ? Promise.resolve(settings.sourceOptions) : Lead.distinct("source", { companyId }),
    settings?.locationOptions?.length ? Promise.resolve(settings.locationOptions) : Lead.distinct("location", { companyId }),
    Lead.distinct("platform", { companyId }),
    Agent.find({ companyId }).select("name").sort({ name: 1 }).lean(),
    Lead.countDocuments({ companyId, phone: { $exists: true, $nin: ["", null] } }),
    Lead.countDocuments({ companyId, email: { $exists: true, $regex: /@/ } }),
    Lead.countDocuments({ companyId, whatsappOptOut: true }),
    Lead.countDocuments({ companyId, emailOptOut: true }),
  ]);
  return res.status(200).json({
    models: models.filter(Boolean).sort(),
    statuses: effectiveStatuses(settings?.statusOptions),
    sources: (sources || []).filter(Boolean).sort(),
    locations: (locations || []).filter(Boolean).sort(),
    platforms: platforms.filter(Boolean).sort(),
    buckets: BUCKETS,
    agents: agents.map((a) => ({ _id: a._id, name: a.name })),
    counts: { withPhone, withEmail, waOptOut, emailOptOut },
  });
}

export default requireAdminOrSuperAdmin(handler);
