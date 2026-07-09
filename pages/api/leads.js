const connectDB = require("../../lib/db");
const Lead = require("../../models/Lead");
const { requireAuth } = require("../../lib/auth");

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { search = "", model = "", status = "", page = "1", pageSize = "20" } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { leadId: { $regex: search, $options: "i" } },
      { model: { $regex: search, $options: "i" } },
    ];
  }
  if (model) {
    filter.model = model;
  }
  if (status) {
    filter.status = status;
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSizeNum = Math.min(Math.max(1, Number(pageSize) || 20), 200);

  const [leads, total, models] = await Promise.all([
    Lead.find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNum - 1) * pageSizeNum)
      .limit(pageSizeNum)
      .lean(),
    Lead.countDocuments(filter),
    Lead.distinct("model"),
  ]);

  res.status(200).json({
    leads,
    total,
    page: pageNum,
    pageSize: pageSizeNum,
    totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
    models: models.filter(Boolean).sort(),
  });
}

export default requireAuth(handler);
