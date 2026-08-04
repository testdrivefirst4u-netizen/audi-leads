const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const Agent = require("../../models/Agent");
const { requireCompanyMemberOrSuperAdminView } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, isUrgentTimeline, nextFollowUp } = require("../../lib/leadFields");
const { withCache } = require("../../lib/serverCache");

const SORTABLE_FIELDS = new Set(["name", "canonicalModel", "status", "sheetCreatedAt"]);
// The model/source filter-dropdown option lists barely change (only when a
// genuinely new model tab or lead source shows up) but this endpoint is
// polled every few seconds — recomputing the full distinct-value scan on
// every single poll is pure waste. 30s is imperceptible for a filter
// dropdown's option list.
const DISTINCT_CACHE_MS = 30000;
// Much shorter than DISTINCT_CACHE_MS on purpose: the follow-up tab counts
// and "hot leads" set are driven by user actions (a remark auto-clearing a
// follow-up, a status change) that people expect to see reflected quickly.
// 5s is short enough to stay well under the page's own poll interval — it
// only collapses redundant concurrent computation, it doesn't add a
// meaningfully longer wait than the poll cadence already imposes.
const FOLLOWUP_TABS_CACHE_MS = 5000;
const HOT_CANDIDATES_CACHE_MS = 5000;

async function distinctModelsAndSources(companyId) {
  return withCache(`leads-distinct:${companyId}`, DISTINCT_CACHE_MS, async () => {
    const [models, sources] = await Promise.all([
      Lead.distinct("canonicalModel", { companyId }),
      Lead.distinct("source", { companyId }),
    ]);
    return { models: models.filter(Boolean).sort(), sources: sources.filter(Boolean).sort() };
  });
}

// A plain JSON.stringify(filter) won't work as a cache key here: filter.$or
// embeds a RegExp for `search`, and RegExp serializes to "{}" — every
// distinct search term would collide onto the same cache entry. Building
// the key from the raw query inputs instead keeps it accurate.
function filterSignature(req, { search = "", model = "", status = "", location = "", source = "", from = "", to = "", agent = "" } = {}) {
  return [
    req.session.companyId,
    req.session.role,
    req.session.agentId || "",
    search,
    model,
    status,
    location,
    source,
    from,
    to,
    agent,
  ].join("|");
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const {
    search = "",
    model = "",
    status = "",
    hot = "",
    from = "",
    to = "",
    agent = "",
    location = "",
    source = "",
    followUpFilter = "",
    page = "1",
    pageSize = "20",
    sortBy = "sheetCreatedAt",
    sortDir = "desc",
  } = req.query;

  const filter = { companyId: req.session.companyId };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { leadId: { $regex: search, $options: "i" } },
      { model: { $regex: search, $options: "i" } },
      { canonicalModel: { $regex: search, $options: "i" } },
    ];
  }
  if (model) {
    filter.canonicalModel = model;
  }
  if (status) {
    filter.status = status;
  }
  if (location) {
    filter.location = location === "unfilled" ? { $in: [null, ""] } : location;
  }
  if (source) {
    filter.source = source;
  }
  // Filters on sheetCreatedAt — the date the lead actually came in on the
  // sheet (its own create_time column), not when we happened to sync it.
  if (from || to) {
    filter.sheetCreatedAt = {};
    if (from) filter.sheetCreatedAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.sheetCreatedAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  // Agents only ever see their own queue. Sessions issued before agent
  // accounts existed have no role claim — treated as admin (see lib/auth.js).
  if (req.session.role === "agent") {
    filter.assignedTo = req.session.agentId;
  } else if (agent) {
    filter.assignedTo = agent === "unassigned" ? null : agent;
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSizeNum = Math.min(Math.max(1, Number(pageSize) || 20), 200);
  const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : "sheetCreatedAt";
  const sortDirection = sortDir === "asc" ? 1 : -1;

  // Follow-up tabs (Overdue/Due Today/Upcoming/Completed) — like "hot"
  // leads above, which bucket a lead falls into can't be expressed as a
  // plain Mongo filter (it depends on the soonest *pending* follow-up's
  // date, computed in JS by nextFollowUp). Narrow to leads that have any
  // follow-ups at all (indexed-ish via the array-exists check) then finish
  // the classification in JS — same low-hundreds-of-leads scale as "hot".
  const followUpSig = filterSignature(req, { search, model, status, location, source, from, to, agent });
  const { followUpTabs, bucketIds } = await withCache(`followup-tabs:${followUpSig}`, FOLLOWUP_TABS_CACHE_MS, async () => {
    const followUpCandidates = await Lead.find({ ...filter, "followUps.0": { $exists: true } })
      .select("followUps")
      .lean();
    const tabs = { overdue: 0, today: 0, upcoming: 0, completed: 0 };
    const ids = { overdue: [], today: [], upcoming: [], completed: [] };
    for (const l of followUpCandidates) {
      const info = nextFollowUp(l);
      if (info && tabs[info.status] !== undefined) {
        tabs[info.status]++;
        ids[info.status].push(l._id);
      }
      if ((l.followUps || []).some((f) => f.completed)) {
        tabs.completed++;
        ids.completed.push(l._id);
      }
    }
    return { followUpTabs: tabs, bucketIds: ids };
  });
  if (followUpFilter && bucketIds[followUpFilter]) {
    filter._id = { $in: bucketIds[followUpFilter] };
  }

  const agentList =
    req.session.role === "admin" || req.session.role === "super_admin" || !req.session.role
      ? await Agent.find({ active: true, companyId: req.session.companyId }).select("name").lean()
      : [];

  // "Hot" leads (urgent purchase timeline + nobody's touched them yet) can't
  // be expressed as a simple Mongo filter, since the timeline answer lives
  // under a different raw column name per tab. Narrow with an indexed filter
  // first (untouched, still New), then finish the match in JS and paginate
  // the filtered result — fine at this data volume (low hundreds of leads).
  if (hot === "true") {
    // `search` deliberately excluded from the cache key — it's applied as a
    // JS filter below, against the same underlying candidate set, so every
    // search term within the cache window can reuse one fetch instead of
    // triggering its own.
    const hotSig = filterSignature(req, { model, location, source, from, to, agent });
    const candidates = await withCache(`hot-candidates:${hotSig}`, HOT_CANDIDATES_CACHE_MS, () =>
      Lead.find({
        companyId: req.session.companyId,
        status: "New",
        "remarks.0": { $exists: false },
        "calls.0": { $exists: false },
        ...(model ? { canonicalModel: model } : {}),
        ...(filter.sheetCreatedAt ? { sheetCreatedAt: filter.sheetCreatedAt } : {}),
        ...(filter.assignedTo !== undefined ? { assignedTo: filter.assignedTo } : {}),
        ...(filter.location ? { location: filter.location } : {}),
        ...(filter.source ? { source: filter.source } : {}),
      })
        .sort({ sheetCreatedAt: -1 })
        .populate("assignedTo", "name")
        .lean()
    );

    const searchLower = search.toLowerCase();
    const hotLeads = candidates.filter((lead) => {
      if (!isUrgentTimeline(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline))) return false;
      if (!searchLower) return true;
      return [lead.name, lead.phone, lead.email, lead.leadId, lead.model, lead.canonicalModel]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(searchLower));
    });

    hotLeads.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDirection === 1 ? cmp : -cmp;
    });

    const total = hotLeads.length;
    const start = (pageNum - 1) * pageSizeNum;
    const leads = hotLeads.slice(start, start + pageSizeNum);
    const { models, sources } = await distinctModelsAndSources(req.session.companyId);

    return res.status(200).json({
      leads,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
      models,
      sources,
      agents: agentList,
      followUpTabs,
    });
  }

  const [[leads, total], { models, sources }] = await Promise.all([
    Promise.all([
      Lead.find(filter)
        .sort({ [sortField]: sortDirection })
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .populate("assignedTo", "name")
        .lean(),
      Lead.countDocuments(filter),
    ]),
    distinctModelsAndSources(req.session.companyId),
  ]);

  res.status(200).json({
    leads,
    total,
    page: pageNum,
    pageSize: pageSizeNum,
    totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
    models,
    sources,
    agents: agentList,
    followUpTabs,
  });
}

export default requireCompanyMemberOrSuperAdminView(handler);
