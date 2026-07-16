const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Settings = require("../../../models/Settings");
const { runSync } = require("../../../lib/syncService");
const { requireSuperAdmin } = require("../../../lib/auth");

function sanitizeSheets(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((s) => ({
      label: String(s?.label || "").trim(),
      sheetId: String(s?.sheetId || "").trim(),
      sheetName: String(s?.sheetName || "").trim(),
    }))
    .filter((s) => s.sheetId);
}

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id } = req.query;
  const { active, name, logoUrl, brandColor, sheets, syncIntervalMinutes } = req.body || {};

  const update = {};
  if (active !== undefined) update.active = Boolean(active);
  if (name !== undefined) update.name = String(name).trim();
  if (logoUrl !== undefined) update.logoUrl = String(logoUrl).trim();
  if (brandColor !== undefined) update.brandColor = String(brandColor).trim();

  let company = await Company.findById(id);
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (Object.keys(update).length > 0) {
    company = await Company.findByIdAndUpdate(id, update, { new: true });
  }

  const sheetUpdate = {};
  const sanitizedSheets = sanitizeSheets(sheets);
  if (sanitizedSheets !== undefined) sheetUpdate.sheets = sanitizedSheets;
  if (syncIntervalMinutes !== undefined) {
    if (![1, 5, 15, 1440].includes(Number(syncIntervalMinutes))) {
      return res.status(400).json({ error: "syncIntervalMinutes must be 1, 5, 15, or 1440 (daily)" });
    }
    sheetUpdate.syncIntervalMinutes = Number(syncIntervalMinutes);
  }

  let settings;
  if (Object.keys(sheetUpdate).length > 0) {
    settings = await Settings.findOneAndUpdate({ companyId: id }, sheetUpdate, { new: true, upsert: true });
    // Same as the old admin-facing flow: apply the new sheet config
    // immediately instead of waiting for the next scheduled cron tick.
    try {
      await runSync(id);
    } catch (err) {
      console.error("Sync after settings update failed:", err);
    }
  }

  res.status(200).json({ company, settings });
}

export default requireSuperAdmin(handler);
