const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();

  const includeAll = req.query.all === "true";
  const match = includeAll ? {} : { "followUps.completed": false };

  const followUps = await Lead.aggregate([
    { $match: { "followUps.0": { $exists: true } } },
    { $unwind: "$followUps" },
    ...(Object.keys(match).length ? [{ $match: match }] : []),
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
        completed: "$followUps.completed",
        completedAt: "$followUps.completedAt",
      },
    },
    { $sort: { date: 1 } },
  ]);

  res.status(200).json({ followUps });
}

export default requireAuth(handler);
