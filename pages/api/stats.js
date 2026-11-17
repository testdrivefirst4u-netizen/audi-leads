const mongoose = require("mongoose");
const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const Settings = require("../../models/Settings");
const Agent = require("../../models/Agent");
const { requireCompanyMemberOrSuperAdminView } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, isUrgentTimeline, normalizeShowroom, effectiveStatuses } = require("../../lib/leadFields");
const { withCache } = require("../../lib/serverCache");

// Keep in sync with models/Lead.js's BUCKETS.
const BUCKETS = ["unassigned", "qualified", "retail", "lost"];
const TREND_DAYS = 30;
// Matches the dashboard's own poll interval (pages/index.js) — this doesn't
// make any single viewer's data staler than it already is between polls; it
// only collapses multiple concurrent viewers (or overlapping requests)
// within the same company into one computation instead of one each.
const STATS_CACHE_MS = 3000;
// Month-by-month history barely moves between polls; worked out once a minute.
const HISTORY_CACHE_MS = 60 * 1000;
const HISTORY_MONTHS = 24;
const QSL_MONTHS = 4;
// "QSL" (qualified sales lead): a lead that got to Qualified or any later stage.
const QUALIFIED_OR_LATER = ["Qualified", "Test Drive", "Booking", "Retail (Converted)"];
const BOOKED_STATUSES = ["Booking", "Retail (Converted)"];
const NEW_THIS_WEEK_LIMIT = 200;
// Months and weeks are counted in India time, where the dealers are.
const IST_OFFSET_MS = 330 * 60 * 1000;

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

// How many enquiries (of any kind) landed in a window, counting every entry
// in every lead's enquiryHistory — so a customer's 2nd/3rd submission for
// the same model counts even though it never became a new Lead document.
// Entries pointing at the same sheet row are collapsed first (an old
// overlapping-sync bug could record one row twice), matching what the lead
// detail's Enquiry History shows. "Repeat enquiries in the window" is then
// simply this minus the new leads created in the same window, since each
// new lead's first history entry is dated by its own sheetCreatedAt.
// Unlike find()/countDocuments(), aggregate() does not cast query values
// through the schema — a string companyId (a super-admin session viewing
// a company) would silently match nothing.
function aggregateMatch(filter) {
  const match = {};
  for (const [key, value] of Object.entries(filter)) {
    match[key] = typeof value === "string" && mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : value;
  }
  return match;
}

async function countEnquiriesBetween(baseFilter, start, end) {
  const match = aggregateMatch(baseFilter);
  const rows = await Lead.aggregate([
    { $match: { ...match, lastEnquiryAt: { $gte: start } } },
    { $unwind: "$enquiryHistory" },
    { $match: { "enquiryHistory.date": { $gte: start, $lt: end } } },
    { $group: { _id: { lead: "$_id", model: "$enquiryHistory.model", row: "$enquiryHistory.rowNumber" } } },
    { $count: "n" },
  ]);
  return rows[0]?.n || 0;
}

// "2026-11" for the month `back` months before the current one (India time).
function istMonth(back) {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return d.toISOString().slice(0, 7);
}

// Leads created per month for the last HISTORY_MONTHS months (zero months
// included), and of those, how many are now qualified or further along.
// Not narrowed by the dashboard's month picker: it's the long view.
async function monthlyHistory(baseFilter) {
  const first = istMonth(HISTORY_MONTHS - 1);
  const start = new Date(new Date(`${first}-01T00:00:00Z`).getTime() - IST_OFFSET_MS);
  const rows = await Lead.aggregate([
    { $match: { ...aggregateMatch(baseFilter), sheetCreatedAt: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$sheetCreatedAt", timezone: "Asia/Kolkata" } },
        count: { $sum: 1 },
        qualified: { $sum: { $cond: [{ $in: ["$status", QUALIFIED_OR_LATER] }, 1, 0] } },
      },
    },
  ]);
  const byMonth = Object.fromEntries(rows.map((r) => [r._id, r]));
  const months = [];
  for (let back = HISTORY_MONTHS - 1; back >= 0; back--) {
    const month = istMonth(back);
    months.push({ month, count: byMonth[month]?.count || 0, qualified: byMonth[month]?.qualified || 0 });
  }
  return months;
}

// This week's new leads (Monday onwards, India time), newest first.
async function newThisWeek(baseFilter) {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday) - IST_OFFSET_MS);
  const filter = { ...baseFilter, sheetCreatedAt: { $gte: start } };
  const [total, leads] = await Promise.all([
    Lead.countDocuments(filter),
    Lead.find(filter)
      .sort({ sheetCreatedAt: -1 })
      .limit(NEW_THIS_WEEK_LIMIT)
      .select("name phone assignedTo sheetCreatedAt source canonicalModel model status")
      .lean(),
  ]);
  const ids = [...new Set(leads.map((l) => l.assignedTo).filter(Boolean).map(String))];
  const agents = ids.length ? await Agent.find({ _id: { $in: ids } }).select("name").lean() : [];
  const names = Object.fromEntries(agents.map((a) => [String(a._id), a.name]));
  return {
    total,
    since: start,
    leads: leads.map((l) => ({
      id: String(l._id),
      name: l.name || "",
      phone: l.phone || "",
      owner: l.assignedTo ? names[String(l.assignedTo)] || "Former agent" : "",
      date: l.sheetCreatedAt,
      model: l.canonicalModel || l.model || "",
      source: l.source || "Meta Ads",
      status: l.status || "New",
    })),
  };
}

async function computeStats(req) {
  const { month = "" } = req.query; // optional "YYYY-MM" — blank means all-time

  // This company's own status list (Settings.statusOptions when configured,
  // else the app-wide default) — computed per-request rather than as a
  // module-level constant, since it now varies by company.
  const settingsDoc = await Settings.findOne({ companyId: req.session.companyId }).select("statusOptions").lean();
  const LEAD_STATUSES = effectiveStatuses(settingsDoc?.statusOptions);

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
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const [totalRecords, newLeadsToday, newLeadsYesterday, enquiriesToday, enquiriesYesterday] = await Promise.all([
    Lead.countDocuments(baseFilter),
    // The sheet's own create_time, not our DB insert time — a lead entered
    // on the sheet last week but only just synced today (e.g. after a sync
    // gap) shouldn't count as "new today".
    Lead.countDocuments({ ...baseFilter, sheetCreatedAt: { $gte: startOfToday } }),
    Lead.countDocuments({ ...baseFilter, sheetCreatedAt: { $gte: startOfYesterday, $lt: startOfToday } }),
    countEnquiriesBetween(baseFilter, startOfToday, endOfToday),
    countEnquiriesBetween(baseFilter, startOfYesterday, startOfToday),
  ]);
  // Repeat enquiries that arrived in the window without creating a lead —
  // the part of today's activity the "new leads" number alone hides.
  const duplicatesToday = Math.max(0, enquiriesToday - newLeadsToday);
  const duplicatesYesterday = Math.max(0, enquiriesYesterday - newLeadsYesterday);

  const leads = await Lead.find(filter)
    .select("model canonicalModel data status bucket sheetCreatedAt calls remarks leadType duplicateCount enquiryHistory source campaign assignedTo")
    .lean();

  const exchangeCounts = { Yes: 0, No: 0, "Not Filled": 0 };
  const showroomCounts = {};
  const modelCounts = {};
  const sourceCounts = {};
  const campaignCounts = {};
  const lostSourceCounts = {};
  const bookedSourceCounts = {};
  const bookedModelCounts = {};
  const pipelineCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  const bucketCounts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));

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

    if (lead.campaign) campaignCounts[lead.campaign] = (campaignCounts[lead.campaign] || 0) + 1;

    const status = LEAD_STATUSES.includes(lead.status) ? lead.status : "New";
    pipelineCounts[status]++;

    if (status === "Lost") lostSourceCounts[sourceName] = (lostSourceCounts[sourceName] || 0) + 1;
    if (BOOKED_STATUSES.includes(status)) {
      bookedSourceCounts[sourceName] = (bookedSourceCounts[sourceName] || 0) + 1;
      bookedModelCounts[modelName] = (bookedModelCounts[modelName] || 0) + 1;
    }

    const bucket = BUCKETS.includes(lead.bucket) ? lead.bucket : "unassigned";
    bucketCounts[bucket]++;

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

  // Agent leaderboard (admins only — an agent's stats are already just
  // their own): per agent, how many of the leads in view they hold, have
  // contacted (moved past New), got to a test drive, and booked/sold.
  let agentBoard = [];
  if (req.session.role !== "agent") {
    const TEST_DRIVE_OR_LATER = new Set(["Test Drive", "Booking", "Retail (Converted)"]);
    const BOOKED = new Set(["Booking", "Retail (Converted)"]);
    const byAgent = {};
    for (const lead of leads) {
      if (!lead.assignedTo) continue;
      const id = String(lead.assignedTo);
      const a = (byAgent[id] ||= { leads: 0, contacted: 0, testDrives: 0, bookings: 0 });
      const st = lead.status || "New";
      a.leads += 1;
      if (st !== "New") a.contacted += 1;
      if (TEST_DRIVE_OR_LATER.has(st)) a.testDrives += 1;
      if (BOOKED.has(st)) a.bookings += 1;
    }
    const ids = Object.keys(byAgent);
    if (ids.length) {
      const agents = await Agent.find({ _id: { $in: ids } }).select("name").lean();
      const names = Object.fromEntries(agents.map((a) => [String(a._id), a.name]));
      agentBoard = ids
        .map((id) => ({ name: names[id] || "Former agent", ...byAgent[id] }))
        .sort((x, y) => y.bookings - x.bookings || y.testDrives - x.testDrives || y.contacted - x.contacted)
        .slice(0, 8);
    }
  }

  const historyKey = `stats-history:${req.session.companyId}:${req.session.role}:${req.session.agentId || ""}`;
  const [monthly, weekLeads] = await Promise.all([withCache(historyKey, HISTORY_CACHE_MS, () => monthlyHistory(baseFilter)), newThisWeek(baseFilter)]);

  return {
    agentBoard,
    monthly,
    qsl: monthly.slice(-QSL_MONTHS),
    newThisWeek: weekLeads,
    lostBySource: toSortedArray(lostSourceCounts),
    bookingsBySource: toSortedArray(bookedSourceCounts),
    bookingsByModel: toSortedArray(bookedModelCounts),
    month: month || null,
    total: leads.length,
    totalRecords,
    newLeadsToday,
    newLeadsYesterday,
    duplicatesToday,
    duplicatesYesterday,
    enquiriesToday,
    enquiriesYesterday,
    totalCalls,
    hotCount,
    exchange: toSortedArray(exchangeCounts),
    showroom: toSortedArray(showroomCounts),
    models: toSortedArray(modelCounts),
    sources: toSortedArray(sourceCounts),
    campaigns: toSortedArray(campaignCounts),
    duplicateDetection: {
      totalEnquiries,
      uniqueLeads: leads.length,
      duplicateEnquiries,
      repeatEnquiryLeads,
      customersAcrossModels,
      vehicleWise: toSortedArray(modelCounts),
    },
    pipeline: LEAD_STATUSES.map((label) => ({ label, count: pipelineCounts[label] })),
    buckets: BUCKETS.map((key) => ({ key, count: bucketCounts[key] })),
    trend,
  };
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { month = "" } = req.query;
  const cacheKey = `stats:${req.session.companyId}:${req.session.role}:${req.session.agentId || ""}:${month}`;
  const payload = await withCache(cacheKey, STATS_CACHE_MS, () => computeStats(req));
  res.status(200).json(payload);
}

export default requireCompanyMemberOrSuperAdminView(handler);
