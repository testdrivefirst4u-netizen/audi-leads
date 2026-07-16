const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Admin = require("../../../models/Admin");
const Agent = require("../../../models/Agent");
const Lead = require("../../../models/Lead");
const Settings = require("../../../models/Settings");
const { hashPassword, requireSuperAdmin } = require("../../../lib/auth");

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function handler(req, res) {
  await connectDB();

  if (req.method === "GET") {
    const companies = await Company.find({}).sort({ createdAt: 1 }).lean();
    const leadCounts = await Lead.aggregate([{ $group: { _id: "$companyId", count: { $sum: 1 } } }]);
    const agentCounts = await Agent.aggregate([{ $group: { _id: "$companyId", count: { $sum: 1 } } }]);
    const allSettings = await Settings.find({}).lean();
    const leadMap = Object.fromEntries(leadCounts.map((c) => [String(c._id), c.count]));
    const agentMap = Object.fromEntries(agentCounts.map((c) => [String(c._id), c.count]));
    const settingsMap = Object.fromEntries(allSettings.map((s) => [String(s.companyId), s]));

    return res.status(200).json({
      companies: companies.map((c) => {
        const s = settingsMap[String(c._id)];
        return {
          _id: c._id,
          name: c.name,
          slug: c.slug,
          logoUrl: c.logoUrl,
          brandColor: c.brandColor || "",
          active: c.active,
          createdAt: c.createdAt,
          leadCount: leadMap[String(c._id)] || 0,
          agentCount: agentMap[String(c._id)] || 0,
          sheets: (s?.sheets || []).map((sh) => ({ _id: sh._id, label: sh.label, sheetId: sh.sheetId, sheetName: sh.sheetName })),
          syncIntervalMinutes: s?.syncIntervalMinutes || 1,
        };
      }),
    });
  }

  if (req.method === "POST") {
    const { name, adminUsername, adminPassword, logoUrl = "", brandColor = "" } = req.body || {};
    if (!name || !adminUsername || !adminPassword) {
      return res.status(400).json({ error: "Company name, admin username, and admin password are required" });
    }

    const baseSlug = slugify(name) || "company";
    let slug = baseSlug;
    let n = 1;
    while (await Company.findOne({ slug })) {
      slug = `${baseSlug}-${++n}`;
    }

    const existingAdmin = await Admin.findOne({ username: adminUsername });
    if (existingAdmin) {
      return res.status(409).json({ error: "That admin username is already taken" });
    }

    const company = await Company.create({ name, slug, logoUrl, brandColor, active: true });
    const passwordHash = await hashPassword(adminPassword);
    await Admin.create({ username: adminUsername, passwordHash, companyId: company._id });

    return res.status(201).json({ company });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdmin(handler);
