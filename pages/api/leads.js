const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");
const { pickField, FIELD_MATCHERS, isUrgentTimeline } = require("../../lib/leadFields");

const SORTABLE_FIELDS = new Set(["name", "canonicalModel", "status", "sheetCreatedAt"]);

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
    page = "1",
    pageSize = "20",
    sortBy = "sheetCreatedAt",
    sortDir = "desc",
  } = req.query;

  const filter = {};
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
  // Filters on sheetCreatedAt — the date the lead actually came in on the
  // sheet (its own create_time column), not when we happened to sync it.
  if (from || to) {
    filter.sheetCreatedAt = {};
    if (from) filter.sheetCreatedAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.sheetCreatedAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSizeNum = Math.min(Math.max(1, Number(pageSize) || 20), 200);
  const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : "sheetCreatedAt";
  const sortDirection = sortDir === "asc" ? 1 : -1;

  // "Hot" leads (urgent purchase timeline + nobody's touched them yet) can't
  // be expressed as a simple Mongo filter, since the timeline answer lives
  // under a different raw column name per tab. Narrow with an indexed filter
  // first (untouched, still New), then finish the match in JS and paginate
  // the filtered result — fine at this data volume (low hundreds of leads).
  if (hot === "true") {
    const candidates = await Lead.find({
      status: "New",
      "remarks.0": { $exists: false },
      "calls.0": { $exists: false },
      ...(model ? { canonicalModel: model } : {}),
      ...(filter.sheetCreatedAt ? { sheetCreatedAt: filter.sheetCreatedAt } : {}),
    })
      .sort({ sheetCreatedAt: -1 })
      .lean();

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
    const models = await Lead.distinct("canonicalModel");

    return res.status(200).json({
      leads,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
      models: models.filter(Boolean).sort(),
    });
  }

  const [leads, total, models] = await Promise.all([
    Lead.find(filter)
      .sort({ [sortField]: sortDirection })
      .skip((pageNum - 1) * pageSizeNum)
      .limit(pageSizeNum)
      .lean(),
    Lead.countDocuments(filter),
    Lead.distinct("canonicalModel"),
  ]);

  res.status(200).json({
    leads,
    total,
    page: pageNum,
    pageSize: pageSizeNum,
    totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
    models: models.filter(Boolean).sort(),
  });
}

export default requireAuth(handler);
