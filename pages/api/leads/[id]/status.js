const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireAuth } = require("../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { status } = req.body || {};
  if (!Lead.LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Lead.LEAD_STATUSES.join(", ")}` });
  }

  await connectDB();
  const lead = await Lead.findByIdAndUpdate(id, { status }, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead });
}

export default requireAuth(handler);
