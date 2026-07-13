const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, isUrgentTimeline } = require("../../lib/leadFields");

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Won", "Lost"];
const TREND_DAYS = 30;

function normalizeExchange(value) {
  if (!value || !value.trim()) return "Not Filled";
  const v = value.trim().toLowerCase();
  if (v.startsWith("yes")) return "Yes";
  if (v.startsWith("no")) return "No";
  return "Not Filled";
}

// Sheet columns spell "showroom"/"location" fields wildly differently per tab
// and sometimes hold a Google Maps link instead of a city name — normalize by
// looking for a known city name in the value rather than trusting its shape.
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

function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { month = "" } = req.query; // optional "YYYY-MM" — blank means all-time

  const filter = {};
  if (/^\d{4}-\d{2}$/.test(month)) {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    filter.sheetCreatedAt = { $gte: start, $lt: end };
  }
  if (req.session.role === "agent") {
    filter.assignedTo = req.session.agentId;
  }

  const leads = await Lead.find(filter)
    .select("model canonicalModel data status sheetCreatedAt calls remarks")
    .lean();

  const exchangeCounts = { Yes: 0, No: 0, "Not Filled": 0 };
  const showroomCounts = {};
  const modelCounts = {};
  const pipelineCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));

  // Build the trend days upfront so days with zero leads still show — the
  // selected month's calendar days if one was picked, otherwise a rolling
  // last-TREND_DAYS window.
  const trendMap = {};
  if (filter.sheetCreatedAt) {
    const cursor = new Date(filter.sheetCreatedAt.$gte);
    while (cursor < filter.sheetCreatedAt.$lt) {
      trendMap[dateKey(cursor)] = 0;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      trendMap[dateKey(d)] = 0;
    }
  }

  let totalCalls = 0;
  let hotCount = 0;

  for (const lead of leads) {
    const exchangeValue = pickField(lead.data, FIELD_MATCHERS.exchangePlan);
    exchangeCounts[normalizeExchange(exchangeValue)]++;

    const untouched =
      (lead.status || "New") === "New" && !(lead.calls || []).length && !(lead.remarks || []).length;
    if (untouched && isUrgentTimeline(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline))) {
      hotCount++;
    }

    const showroom = normalizeShowroom(pickField(lead.data, FIELD_MATCHERS.showroom));
    if (showroom) showroomCounts[showroom] = (showroomCounts[showroom] || 0) + 1;

    const modelName = lead.canonicalModel || lead.model || "Unknown";
    modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;

    const status = LEAD_STATUSES.includes(lead.status) ? lead.status : "New";
    pipelineCounts[status]++;

    totalCalls += (lead.calls || []).length;

    if (lead.sheetCreatedAt) {
      const key = dateKey(lead.sheetCreatedAt);
      if (key in trendMap) trendMap[key]++;
    }
  }

  const trend = Object.entries(trendMap).map(([date, count]) => ({ date, count }));

  res.status(200).json({
    month: month || null,
    total: leads.length,
    totalCalls,
    hotCount,
    exchange: toSortedArray(exchangeCounts),
    showroom: toSortedArray(showroomCounts),
    models: toSortedArray(modelCounts),
    pipeline: LEAD_STATUSES.map((label) => ({ label, count: pipelineCounts[label] })),
    trend,
  });
}

export default requireAuth(handler);
