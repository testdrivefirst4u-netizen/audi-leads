const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireCompanyMemberOrSuperAdminView } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, normalizeShowroom } = require("../../lib/leadFields");

function toBreakdown(obj) {
  const rows = Object.entries(obj)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({ ...r, percentage: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0 }));
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { month } = req.query; // "YYYY-MM"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month is required, format YYYY-MM" });
  }

  await connectDB();

  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const filter = { companyId: req.session.companyId, sheetCreatedAt: { $gte: start, $lt: end } };
  const filtersApplied = { Month: month };
  if (req.session.role === "agent") {
    filter.assignedTo = req.session.agentId;
    filtersApplied.Agent = "Assigned to me";
  }

  const leads = await Lead.find(filter)
    .select("model canonicalModel data status calls sheetCreatedAt source")
    .lean();

  const modelCounts = {};
  const showroomCounts = {};
  const statusCounts = {};
  const sourceCounts = {};
  let totalCalls = 0;

  for (const lead of leads) {
    const modelName = lead.canonicalModel || lead.model || "Unknown";
    modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;

    const sourceName = lead.source || "Meta Ads";
    sourceCounts[sourceName] = (sourceCounts[sourceName] || 0) + 1;

    const showroom = normalizeShowroom(pickField(lead.data, FIELD_MATCHERS.showroom));
    if (showroom) showroomCounts[showroom] = (showroomCounts[showroom] || 0) + 1;

    const status = lead.status || "New";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    totalCalls += (lead.calls || []).length;
  }

  const endDate = new Date(end);
  endDate.setUTCDate(endDate.getUTCDate() - 1);

  res.status(200).json({
    month,
    total: leads.length,
    totalCalls,
    dateRange: { from: start.toISOString().slice(0, 10), to: endDate.toISOString().slice(0, 10) },
    filtersApplied,
    byModel: toBreakdown(modelCounts),
    byShowroom: toBreakdown(showroomCounts),
    byStatus: toBreakdown(statusCounts),
    bySource: toBreakdown(sourceCounts),
  });
}

export default requireCompanyMemberOrSuperAdminView(handler);
