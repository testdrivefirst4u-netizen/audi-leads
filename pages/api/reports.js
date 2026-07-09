const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS } = require("../../lib/leadFields");

function normalizeShowroom(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return null;
  const v = value.toLowerCase();
  if (v.includes("hyderabad")) return "Hyderabad";
  if (v.includes("vijayawada")) return "Vijayawada";
  if (v.includes("visakhapatnam") || v.includes("vizag")) return "Visakhapatnam";
  return "Other";
}

function toSortedArray(obj) {
  return Object.entries(obj)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
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

  const leads = await Lead.find({ createdAt: { $gte: start, $lt: end } })
    .select("model data status calls createdAt")
    .lean();

  const modelCounts = {};
  const showroomCounts = {};
  const statusCounts = {};
  let totalCalls = 0;

  for (const lead of leads) {
    const modelName = lead.model || "Unknown";
    modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;

    const showroom = normalizeShowroom(pickField(lead.data, FIELD_MATCHERS.showroom));
    if (showroom) showroomCounts[showroom] = (showroomCounts[showroom] || 0) + 1;

    const status = lead.status || "New";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    totalCalls += (lead.calls || []).length;
  }

  res.status(200).json({
    month,
    total: leads.length,
    totalCalls,
    byModel: toSortedArray(modelCounts),
    byShowroom: toSortedArray(showroomCounts),
    byStatus: toSortedArray(statusCounts),
  });
}

export default requireAuth(handler);
