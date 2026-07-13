const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireAuth } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { note } = req.body || {};

  await connectDB();
  const lead = await Lead.findOneAndUpdate(
    leadOwnershipFilter(req.session, id),
    { $push: { calls: { calledAt: new Date(), note: (note || "").trim() } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  res.status(200).json({ lead });
}

export default requireAuth(handler);
