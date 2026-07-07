const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { search = "", limit = 200 } = req.query;

  const filter = search
    ? {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { leadId: { $regex: search, $options: "i" } },
          { model: { $regex: search, $options: "i" } },
        ],
      }
    : {};

  const leads = await Lead.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(Number(limit) || 200, 1000))
    .lean();

  res.status(200).json({ leads });
}

export default requireAuth(handler);
