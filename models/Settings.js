const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    sheetId: { type: String, default: "" },
    // Blank = sync every tab in the spreadsheet. Comma-separated tab names to restrict to a subset.
    sheetName: { type: String, default: "" },
    syncIntervalMinutes: { type: Number, enum: [1, 5, 15], default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
