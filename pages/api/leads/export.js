const XLSX = require("xlsx");
const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireCompanyMemberOrSuperAdminView } = require("../../../lib/auth");
const { pickField, FIELD_MATCHERS, prettify } = require("../../../lib/leadFields");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { from, to, model = "", status = "", agent = "", location = "", source = "" } = req.query;

  const filter = { companyId: req.session.companyId };
  if (model) filter.canonicalModel = model;
  if (status) filter.status = status;
  if (location) filter.location = location === "unfilled" ? { $in: [null, ""] } : location;
  if (source) filter.source = source;
  if (from || to) {
    filter.sheetCreatedAt = {};
    if (from) filter.sheetCreatedAt.$gte = new Date(`${from}T00:00:00Z`);
    if (to) filter.sheetCreatedAt.$lte = new Date(`${to}T23:59:59Z`);
  }
  if (req.session.role === "agent") {
    filter.assignedTo = req.session.agentId;
  } else if (agent) {
    filter.assignedTo = agent === "unassigned" ? null : agent;
  }

  const leads = await Lead.find(filter).sort({ sheetCreatedAt: -1 }).populate("assignedTo", "name").lean();

  // Remark counts vary per lead, but a spreadsheet needs one fixed set of
  // columns — so the number of "Remark N" columns is sized to whichever lead
  // in this export has the most, and shorter leads just leave the extra cells blank.
  const maxRemarks = leads.reduce((max, lead) => Math.max(max, (lead.remarks || []).length), 0);
  const remarkHeaders = Array.from({ length: maxRemarks }, (_, i) => `Remark ${i + 1}`);

  const header = [
    "Created",
    "Campaign",
    "Model",
    "Name",
    "Phone",
    "Email",
    "Source",
    "Agent",
    "Status",
    "Calls Made",
    "Purchase Timeline",
    "Exchange Plan",
    "Showroom",
    ...remarkHeaders,
    "Next Follow-up",
  ];

  const rows = leads.map((lead) => {
    const remarks = [...(lead.remarks || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const remarkCells = Array.from({ length: maxRemarks }, (_, i) =>
      remarks[i] ? `${new Date(remarks[i].createdAt).toLocaleDateString()}: ${remarks[i].text}` : ""
    );
    const pendingFollowUps = (lead.followUps || [])
      .filter((f) => !f.completed)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const nextFollowUp = pendingFollowUps.length ? new Date(pendingFollowUps[0].date).toLocaleDateString() : "";

    return [
      lead.sheetCreatedAt ? new Date(lead.sheetCreatedAt).toLocaleDateString() : "",
      pickField(lead.data, FIELD_MATCHERS.campaign),
      lead.canonicalModel || lead.model || "",
      lead.name || "",
      lead.phone || "",
      lead.email || "",
      lead.source || "Meta Ads",
      lead.assignedTo?.name || "Unassigned",
      lead.status || "New",
      (lead.calls || []).length,
      prettify(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline)),
      prettify(pickField(lead.data, FIELD_MATCHERS.exchangePlan)),
      prettify(pickField(lead.data, FIELD_MATCHERS.showroom)),
      ...remarkCells,
      nextFollowUp,
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [
    { wch: 14 }, // Created
    { wch: 18 }, // Campaign
    { wch: 14 }, // Model
    { wch: 22 }, // Name
    { wch: 14 }, // Phone
    { wch: 26 }, // Email
    { wch: 14 }, // Source
    { wch: 18 }, // Agent
    { wch: 18 }, // Status
    { wch: 11 }, // Calls Made
    { wch: 20 }, // Purchase Timeline
    { wch: 16 }, // Exchange Plan
    { wch: 16 }, // Showroom
    ...remarkHeaders.map(() => ({ wch: 30 })),
    { wch: 14 }, // Next Follow-up
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Leads");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
}

export default requireCompanyMemberOrSuperAdminView(handler);
