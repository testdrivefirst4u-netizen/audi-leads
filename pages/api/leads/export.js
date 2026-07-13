const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireAuth } = require("../../../lib/auth");
const { toCsv } = require("../../../lib/csv");
const { pickField, FIELD_MATCHERS, prettify } = require("../../../lib/leadFields");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { from, to, model = "", status = "", agent = "" } = req.query;

  const filter = {};
  if (model) filter.canonicalModel = model;
  if (status) filter.status = status;
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

  const header = [
    "Model",
    "Sheet Tab",
    "Lead ID",
    "Name",
    "Phone",
    "Email",
    "Agent",
    "Status",
    "Calls Made",
    "Created",
    "Campaign",
    "Purchase Timeline",
    "Exchange Plan",
    "Showroom",
    "Latest Remark",
    "Next Follow-up",
  ];

  const rows = leads.map((lead) => {
    const remarks = lead.remarks || [];
    const latestRemark = remarks.length ? remarks[remarks.length - 1].text : "";
    const pendingFollowUps = (lead.followUps || [])
      .filter((f) => !f.completed)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const nextFollowUp = pendingFollowUps.length ? new Date(pendingFollowUps[0].date).toLocaleDateString() : "";

    return [
      lead.canonicalModel || lead.model || "",
      lead.model || "",
      lead.leadId || "",
      lead.name || "",
      lead.phone || "",
      lead.email || "",
      lead.assignedTo?.name || "Unassigned",
      lead.status || "New",
      (lead.calls || []).length,
      lead.sheetCreatedAt ? new Date(lead.sheetCreatedAt).toLocaleDateString() : "",
      pickField(lead.data, FIELD_MATCHERS.campaign),
      prettify(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline)),
      prettify(pickField(lead.data, FIELD_MATCHERS.exchangePlan)),
      prettify(pickField(lead.data, FIELD_MATCHERS.showroom)),
      latestRemark,
      nextFollowUp,
    ];
  });

  const csv = toCsv([header, ...rows]);
  const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Excel needs a UTF-8 BOM to render non-ASCII characters correctly.
  res.status(200).send(`﻿${csv}`);
}

export default requireAuth(handler);
