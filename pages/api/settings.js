const connectDB = require("../../lib/db");
const Settings = require("../../models/Settings");
const { runSync, getSettings } = require("../../lib/syncService");
const { requireAuth } = require("../../lib/auth");

async function handler(req, res) {
  await connectDB();

  if (req.method === "GET") {
    const settings = await getSettings();
    return res.status(200).json({ settings });
  }

  if (req.method === "POST") {
    const { sheetId, sheetName, syncIntervalMinutes } = req.body || {};

    if (syncIntervalMinutes !== undefined && ![1, 5, 15, 1440].includes(Number(syncIntervalMinutes))) {
      return res.status(400).json({ error: "syncIntervalMinutes must be 1, 5, 15, or 1440 (daily)" });
    }

    const update = {};
    if (sheetId !== undefined) update.sheetId = String(sheetId).trim();
    if (sheetName !== undefined) update.sheetName = String(sheetName).trim();
    if (syncIntervalMinutes !== undefined) update.syncIntervalMinutes = Number(syncIntervalMinutes);

    const settings = await Settings.findOneAndUpdate({ key: "default" }, update, {
      new: true,
      upsert: true,
    });

    // Apply the new config immediately instead of waiting for the next tick.
    // Awaited (not fire-and-forget) because serverless functions can freeze
    // right after the response is sent, which would cut a background sync short.
    try {
      await runSync();
    } catch (err) {
      console.error("Sync after settings update failed:", err);
    }

    return res.status(200).json({ settings });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireAuth(handler);
