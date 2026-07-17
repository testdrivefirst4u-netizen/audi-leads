const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireCompanyMemberOrSuperAdminView } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, isUrgentTimeline, normalizeShowroom } = require("../../lib/leadFields");

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Test Drive", "Booking", "Retail (Converted)", "Lost"];
const TREND_DAYS = 30;

function normalizeExchange(value) {
  if (!value || !value.trim()) return "Not Filled";
  const v = value.trim().toLowerCase();
  if (v.startsWith("yes")) return "Yes";
  if (v.startsWith("no")) return "No";
  return "Not Filled";
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

  const filter = { companyId: req.session.companyId };
  if (/^\d{4}-\d{2}$/.test(month)) {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    filter.sheetCreatedAt = { $gte: start, $lt: end };
  }
  if (req.session.role === "agent") {
    filter.assignedTo = req.session.agentId;
  }

  // Always-visible "Total Records Imported" / "New Leads Today" — same
  // company+agent scope as everything else here, but never narrowed by the
  // month filter, since these two are meant to read as running totals.
  const baseFilter = { companyId: req.session.companyId };
  if (req.session.role === "agent") baseFilter.assignedTo = req.session.agentId;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const [totalRecords, newLeadsToday, newLeadsYesterday] = await Promise.all([
    Lead.countDocuments(baseFilter),
    // The sheet's own create_time, not our DB insert time — a lead entered
    // on the sheet last week but only just synced today (e.g. after a sync
    // gap) shouldn't count as "new today".
    Lead.countDocuments({ ...baseFilter, sheetCreatedAt: { $gte: startOfToday } }),
    Lead.countDocuments({ ...baseFilter, sheetCreatedAt: { $gte: startOfYesterday, $lt: startOfToday } }),
  ]);

  const leads = await Lead.find(filter)
    .select("model canonicalModel data status sheetCreatedAt calls remarks leadType duplicateCount enquiryHistory source")
    .lean();

  const exchangeCounts = { Yes: 0, No: 0, "Not Filled": 0 };
  const showroomCounts = {};
  const modelCounts = {};
  const sourceCounts = {};
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
  let totalEnquiries = 0;
  let repeatEnquiryLeads = 0;
  let duplicateEnquiries = 0;
  let customersAcrossModels = 0;

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

    const sourceName = lead.source || "Meta Ads";
    sourceCounts[sourceName] = (sourceCounts[sourceName] || 0) + 1;

    const status = LEAD_STATUSES.includes(lead.status) ? lead.status : "New";
    pipelineCounts[status]++;

    totalCalls += (lead.calls || []).length;

    const enquiryCount = (lead.enquiryHistory || []).length || 1;
    totalEnquiries += enquiryCount;
    if ((lead.duplicateCount || 0) > 0) {
      repeatEnquiryLeads++;
      duplicateEnquiries += lead.duplicateCount;
    }
    if (lead.leadType === "new_model_existing_customer") customersAcrossModels++;

    if (lead.sheetCreatedAt) {
      const key = dateKey(lead.sheetCreatedAt);
      if (key in trendMap) trendMap[key]++;
    }
  }

  const trend = Object.entries(trendMap).map(([date, count]) => ({ date, count }));

  res.status(200).json({
    month: month || null,
    total: leads.length,
    totalRecords,
    newLeadsToday,
    newLeadsYesterday,
    totalCalls,
    hotCount,
    exchange: toSortedArray(exchangeCounts),
    showroom: toSortedArray(showroomCounts),
    models: toSortedArray(modelCounts),
    sources: toSortedArray(sourceCounts),
    duplicateDetection: {
      totalEnquiries,
      uniqueLeads: leads.length,
      duplicateEnquiries,
      repeatEnquiryLeads,
      customersAcrossModels,
      vehicleWise: toSortedArray(modelCounts),
    },
    pipeline: LEAD_STATUSES.map((label) => ({ label, count: pipelineCounts[label] })),
    trend,
  });
}

export default requireCompanyMemberOrSuperAdminView(handler);
