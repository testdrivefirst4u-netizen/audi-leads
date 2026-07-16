const mongoose = require("mongoose");
const connectDB = require("../../lib/db");
const Company = require("../../models/Company");
const Lead = require("../../models/Lead");
const Agent = require("../../models/Agent");
const Admin = require("../../models/Admin");
const Settings = require("../../models/Settings");
const SyncLog = require("../../models/SyncLog");
const ApiKey = require("../../models/ApiKey");
const ApiKeyLog = require("../../models/ApiKeyLog");
const { requireSuperAdmin } = require("../../lib/auth");

// MongoDB/Atlas doesn't expose your plan's storage cap via any query — this
// has to be configured to match whatever cluster tier you're actually on
// (512 = Atlas's free M0 tier, the default assumption for this project's
// cluster naming pattern). Bump MONGODB_STORAGE_LIMIT_MB if you upgrade.
const STORAGE_LIMIT_MB = Number(process.env.MONGODB_STORAGE_LIMIT_MB) || 512;
const BYTES_PER_MB = 1024 * 1024;

// Only the collections that carry a companyId — used to attribute raw
// document storage to a tenant. Index storage (also counted against the
// Atlas cap) isn't attributable per-company, so this is a close estimate of
// each company's footprint, not an exact split of the cluster's total.
const COMPANY_SCOPED_MODELS = [Lead, Agent, Admin, Settings, SyncLog, ApiKey, ApiKeyLog];

async function bytesByCompany(Model) {
  return Model.aggregate([
    { $match: { companyId: { $ne: null } } },
    { $group: { _id: "$companyId", bytes: { $sum: { $bsonSize: "$$ROOT" } } } },
  ]);
}

function toMB(bytes) {
  return +(bytes / BYTES_PER_MB).toFixed(2);
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();

  const dbStats = await mongoose.connection.db.stats();
  const usedMB = toMB(dbStats.dataSize);
  const limitMB = STORAGE_LIMIT_MB;

  const companies = await Company.find({}).select("name slug").lean();

  const perCompanyBytes = {};
  for (const Model of COMPANY_SCOPED_MODELS) {
    const rows = await bytesByCompany(Model);
    for (const row of rows) {
      const key = String(row._id);
      perCompanyBytes[key] = (perCompanyBytes[key] || 0) + row.bytes;
    }
  }

  const perCompany = companies
    .map((c) => ({
      companyId: c._id,
      name: c.name,
      usedMB: toMB(perCompanyBytes[String(c._id)] || 0),
    }))
    .sort((a, b) => b.usedMB - a.usedMB);

  res.status(200).json({
    usedMB,
    limitMB,
    remainingMB: +(limitMB - usedMB).toFixed(2),
    percentUsed: +Math.min((usedMB / limitMB) * 100, 100).toFixed(1),
    storageSizeMB: toMB(dbStats.storageSize),
    indexSizeMB: toMB(dbStats.indexSize),
    perCompany,
  });
}

export default requireSuperAdmin(handler);
