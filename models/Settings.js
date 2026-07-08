const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    sheetId: { type: String, default: "" },
    // Blank = sync every tab in the spreadsheet. Comma-separated tab names to restrict to a subset.
    sheetName: { type: String, default: "" },
    // 1440 = "Daily", for hosts (e.g. Vercel Hobby) where the sync can only
    // realistically run once a day — keeps the Online/Offline threshold accurate.
    syncIntervalMinutes: { type: Number, enum: [1, 5, 15, 1440], default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
