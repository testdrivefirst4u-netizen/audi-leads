const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();

  const pending = await Lead.aggregate([
    { $match: { "followUps.0": { $exists: true } } },
    { $unwind: "$followUps" },
    { $match: { "followUps.completed": false } },
    {
      $project: {
        _id: 0,
        leadId: "$_id",
        name: 1,
        phone: 1,
        email: 1,
        model: 1,
        followUpId: "$followUps._id",
        date: "$followUps.date",
        note: "$followUps.note",
      },
    },
    { $sort: { date: 1 } },
  ]);

  res.status(200).json({ followUps: pending });
}

export default requireAuth(handler);
