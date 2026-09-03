const XLSX = require("xlsx");
const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const Settings = require("../../../models/Settings");
const { requireCompanyMemberOrSuperAdminView } = require("../../../lib/auth");
const { pickField, prettify, bucketFilterValue } = require("../../../lib/leadFields");

// Lead fields (name, remarks, anything from the public API's freeform
// payload) aren't fully trusted — they can originate from a public lead
// form or an external integration. Excel/Sheets treats a cell starting with
// =, +, -, or @ as a formula; prefixing it with a plain quote forces
// "text", the standard mitigation for CSV/Excel formula injection (an
// exported file that gets opened by an admin should never be able to run
// code just because a "customer name" was crafted maliciously).
const FORMULA_TRIGGER_RE = /^[=+\-@]/;
function sanitizeCell(value) {
  if (typeof value !== "string") return value;
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { from, to, model = "", status = "", agent = "", location = "", source = "", bucket = "" } = req.query;

  const filter = { companyId: req.session.companyId };
  if (model) filter.canonicalModel = model;
  if (status) filter.status = status;
  if (location) filter.location = location === "unfilled" ? { $in: [null, ""] } : location;
  if (source) filter.source = source;
  if (bucket) filter.bucket = bucketFilterValue(bucket);
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

  const [leads, settings] = await Promise.all([
    Lead.find(filter).sort({ sheetCreatedAt: -1 }).populate("assignedTo", "name").lean(),
    Settings.findOne({ companyId: req.session.companyId }).select("leadFieldColumns").lean(),
  ]);
  const fieldColumns = (settings?.leadFieldColumns || []).map((c) => ({
    ...c,
    patterns: (c.matchers || []).map((m) => new RegExp(m, "i")),
  }));

  // Remark counts vary per lead, but a spreadsheet needs one fixed set of
  // columns — so the number of "Remark N" columns is sized to whichever lead
  // in this export has the most, and shorter leads just leave the extra cells blank.
  const maxRemarks = leads.reduce((max, lead) => Math.max(max, (lead.remarks || []).length), 0);
  const remarkHeaders = Array.from({ length: maxRemarks }, (_, i) => `Remark ${i + 1}`);

  const header = [
    "Created",
    "Model",
    "Name",
    "Phone",
    "Email",
    "Source",
    "Agent",
    "Status",
    "Calls Made",
    ...fieldColumns.map((c) => c.label),
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
      lead.canonicalModel || lead.model || "",
      lead.name || "",
      lead.phone || "",
      lead.email || "",
      lead.source || "Meta Ads",
      lead.assignedTo?.name || "Unassigned",
      lead.status || "New",
      (lead.calls || []).length,
      ...fieldColumns.map((c) => prettify(pickField(lead.data, c.patterns))),
      ...remarkCells,
      nextFollowUp,
    ].map(sanitizeCell);
  });

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [
    { wch: 14 }, // Created
    { wch: 14 }, // Model
    { wch: 22 }, // Name
    { wch: 14 }, // Phone
    { wch: 26 }, // Email
    { wch: 14 }, // Source
    { wch: 18 }, // Agent
    { wch: 18 }, // Status
    { wch: 11 }, // Calls Made
    ...fieldColumns.map(() => ({ wch: 20 })),
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
