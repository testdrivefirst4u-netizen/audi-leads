const mongoose = require("mongoose");

// One entry per linked Google Sheet. A company can have several — e.g. a
// primary CRM sheet plus a separate campaign or portal-export sheet — each
// synced independently every run. Tab names should be kept unique *across*
// a company's sheets: dedup/idempotency in lib/syncService.js keys off
// (companyId, tab name, rowNumber), not sheetId, so two sheets with an
// identically-named tab would collide.
const SheetSourceSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" }, // e.g. "Primary", "CarDekho Export"
    sheetId: { type: String, required: true },
    // Blank = sync every tab in this sheet. Comma-separated tab names to restrict to a subset.
    sheetName: { type: String, default: "" },
  },
  { _id: true }
);

// One entry per extra lead-table column a company wants to see, beyond the
// fixed core fields (name/phone/email/model/status/etc). `matchers` are
// regex source strings (case-insensitive) matched against each lead's raw
// `data` keys — the same approach lib/leadFields.js's FIELD_MATCHERS already
// uses, because sheet headers vary slightly per tab/export even within one
// company (e.g. "any_plan_to_exchange" vs the longer variant).
const LeadFieldColumnSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // stable id, e.g. "purchaseTimeline"
    label: { type: String, required: true }, // display label, e.g. "Preferred Service Location"
    matchers: { type: [String], default: [] },
  },
  { _id: false }
);

const SettingsSchema = new mongoose.Schema(
  {
    // Legacy single-tenant lookup key — no longer unique (every company's
    // Settings doc would otherwise collide on "default"). Left in place
    // unused rather than removed; companyId is the real key now.
    key: { type: String, default: "default" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    // Legacy single-sheet fields — superseded by `sheets` below. Left in
    // place (unused by new code) rather than removed; a migration backfills
    // any pre-existing value into `sheets` once.
    sheetId: { type: String, default: "" },
    sheetName: { type: String, default: "" },
    sheets: { type: [SheetSourceSchema], default: [] },
    // Per-company extra Leads-table columns — see LeadFieldColumnSchema
    // above. Empty means the table shows only the core fixed columns.
    leadFieldColumns: { type: [LeadFieldColumnSchema], default: [] },
    // 1440 = "Daily", for hosts (e.g. Vercel Hobby) where the sync can only
    // realistically run once a day — keeps the Online/Offline threshold accurate.
    syncIntervalMinutes: { type: Number, enum: [1, 5, 15, 1440], default: 1 },
    // Advisory lock so two overlapping runSync() calls for the same company
    // (e.g. the local dev scheduler firing again before a long previous run
    // finished) can't both decide the same sheet row is new and each create
    // their own Lead for it — see lib/syncService.js.
    syncLock: {
      inProgress: { type: Boolean, default: false },
      startedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
