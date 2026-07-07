const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireAuth } = require("../../../../lib/auth");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Remark text is required" });
  }

  await connectDB();
  const lead = await Lead.findByIdAndUpdate(
    id,
    { $push: { remarks: { text: text.trim(), createdAt: new Date() } } },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  if (global._io) global._io.emit("leads:changed", { updatedCount: 1 });
  res.status(200).json({ lead });
}

export default requireAuth(handler);
