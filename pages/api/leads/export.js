const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireAuth } = require("../../../lib/auth");
const { toCsv } = require("../../../lib/csv");
const { pickField, FIELD_MATCHERS, prettify } = require("../../../lib/leadFields");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { from, to, model = "" } = req.query;

  const filter = {};
  if (model) filter.model = model;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00Z`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59Z`);
  }

  const leads = await Lead.find(filter).sort({ createdAt: -1 }).lean();

  const header = [
    "Model",
    "Lead ID",
    "Name",
    "Phone",
    "Email",
    "Created (Sheet)",
    "Campaign",
    "Purchase Timeline",
    "Exchange Plan",
    "Showroom",
    "Latest Remark",
    "Next Follow-up",
    "Synced At",
    "Updated At",
  ];

  const rows = leads.map((lead) => {
    const remarks = lead.remarks || [];
    const latestRemark = remarks.length ? remarks[remarks.length - 1].text : "";
    const pendingFollowUps = (lead.followUps || [])
      .filter((f) => !f.completed)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const nextFollowUp = pendingFollowUps.length ? new Date(pendingFollowUps[0].date).toLocaleDateString() : "";

    return [
      lead.model || "",
      lead.leadId || "",
      lead.name || "",
      lead.phone || "",
      lead.email || "",
      pickField(lead.data, FIELD_MATCHERS.createdTime),
      pickField(lead.data, FIELD_MATCHERS.campaign),
      prettify(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline)),
      prettify(pickField(lead.data, FIELD_MATCHERS.exchangePlan)),
      prettify(pickField(lead.data, FIELD_MATCHERS.showroom)),
      latestRemark,
      nextFollowUp,
      lead.createdAt ? new Date(lead.createdAt).toLocaleString() : "",
      lead.updatedAt ? new Date(lead.updatedAt).toLocaleString() : "",
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
