const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const Settings = require("../../../models/Settings");
const { runSync } = require("../../../lib/syncService");
const { requireSuperAdmin } = require("../../../lib/auth");
const { invalidate } = require("../../../lib/serverCache");

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

function sanitizeLeadFieldColumns(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((c) => ({
      key: String(c?.key || "").trim(),
      label: String(c?.label || "").trim(),
      matchers: Array.isArray(c?.matchers) ? c.matchers.map((m) => String(m).trim()).filter(Boolean) : [],
    }))
    .filter((c) => c.key && c.label && c.matchers.length > 0);
}

function sanitizeStringList(input) {
  if (!Array.isArray(input)) return undefined;
  return input.map((s) => String(s || "").trim()).filter(Boolean);
}

function sanitizeSourceMap(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((e) => ({ from: String(e?.from || "").trim(), to: String(e?.to || "").trim() }))
    .filter((e) => e.from && e.to);
}

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id } = req.query;
  const {
    active,
    name,
    logoUrl,
    brandColor,
    sheets,
    syncIntervalMinutes,
    leadFieldColumns,
    statusOptions,
    sourceOptions,
    sourceMap,
    locationField,
    locationOptions,
  } = req.body || {};

  const update = {};
  if (active !== undefined) update.active = Boolean(active);
  if (name !== undefined) update.name = String(name).trim();
  if (logoUrl !== undefined) update.logoUrl = String(logoUrl).trim();
  if (brandColor !== undefined) update.brandColor = String(brandColor).trim();

  let company = await Company.findById(id);
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (Object.keys(update).length > 0) {
    company = await Company.findByIdAndUpdate(id, update, { new: true });
    // getCompanyBranding() caches name/logo/brandColor for 5 minutes — an
    // explicit edit here should be visible right away, not after a wait.
    invalidate(`branding:${id}`);
  }

  const settingsUpdate = {};
  let needsResync = false;
  const sanitizedSheets = sanitizeSheets(sheets);
  if (sanitizedSheets !== undefined) {
    settingsUpdate.sheets = sanitizedSheets;
    needsResync = true;
  }
  if (syncIntervalMinutes !== undefined) {
    if (![1, 5, 15, 1440].includes(Number(syncIntervalMinutes))) {
      return res.status(400).json({ error: "syncIntervalMinutes must be 1, 5, 15, or 1440 (daily)" });
    }
    settingsUpdate.syncIntervalMinutes = Number(syncIntervalMinutes);
    needsResync = true;
  }
  const sanitizedLeadFieldColumns = sanitizeLeadFieldColumns(leadFieldColumns);
  if (sanitizedLeadFieldColumns !== undefined) {
    // Purely a display-config change — doesn't touch anything the sync
    // reads, so it doesn't need to trigger one.
    settingsUpdate.leadFieldColumns = sanitizedLeadFieldColumns;
  }

  // statusOptions/sourceOptions are display-only, like leadFieldColumns
  // above — they only change which filter options render, not any stored
  // lead data. sourceMap/locationField are the opposite: they change how
  // future syncs classify raw sheet data (lib/leadFields.js's
  // applySourceMap/resolveLocation), so those two trigger a resync — same
  // as sheets/syncIntervalMinutes. Note a resync only affects newly-synced
  // rows, not leads already ingested; existing leads need a one-time
  // backfill if their historical values should change too.
  const sanitizedStatusOptions = sanitizeStringList(statusOptions);
  if (sanitizedStatusOptions !== undefined) {
    settingsUpdate.statusOptions = sanitizedStatusOptions;
  }
  const sanitizedSourceOptions = sanitizeStringList(sourceOptions);
  if (sanitizedSourceOptions !== undefined) {
    settingsUpdate.sourceOptions = sanitizedSourceOptions;
  }
  const sanitizedSourceMap = sanitizeSourceMap(sourceMap);
  if (sanitizedSourceMap !== undefined) {
    settingsUpdate.sourceMap = sanitizedSourceMap;
    needsResync = true;
  }
  if (locationField !== undefined) {
    settingsUpdate.locationField = String(locationField).trim();
    needsResync = true;
  }
  // Display-only, like statusOptions/sourceOptions — curates the filter
  // dropdown, doesn't touch what a lead's `location` gets set to.
  const sanitizedLocationOptions = sanitizeStringList(locationOptions);
  if (sanitizedLocationOptions !== undefined) {
    settingsUpdate.locationOptions = sanitizedLocationOptions;
  }

  let settings;
  if (Object.keys(settingsUpdate).length > 0) {
    settings = await Settings.findOneAndUpdate({ companyId: id }, settingsUpdate, { new: true, upsert: true });
    // Filter option lists are read through a short (30s) cache in
    // pages/api/leads.js — invalidate it so a save here shows up right
    // away instead of the admin waiting out the TTL to confirm it worked.
    invalidate(`leads-meta:${id}`);
    if (needsResync) {
      // Same as the old admin-facing flow: apply the new sheet config
      // immediately instead of waiting for the next scheduled cron tick.
      try {
        await runSync(id);
      } catch (err) {
        console.error("Sync after settings update failed:", err);
      }
    }
  }

  res.status(200).json({ company, settings });
}

export default requireSuperAdmin(handler);
