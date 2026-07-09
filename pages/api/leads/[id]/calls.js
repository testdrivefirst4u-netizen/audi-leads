const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireAuth } = require("../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { note } = req.body || {};

  await connectDB();
  const lead = await Lead.findByIdAndUpdate(
    id,
    { $push: { calls: { calledAt: new Date(), note: (note || "").trim() } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead });
}

export default requireAuth(handler);
