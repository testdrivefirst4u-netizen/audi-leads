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

// One entry per raw->normalized source-value remap (e.g. a sheet's literal
// "Meta Ads" collapsed to a company's own "Meta" vocabulary) — applied at
// ingest time (see lib/leadFields.js's applySourceMap) so a company's Lead
// Source filter options actually match what's stored, not just what the
// dropdown offers.
const SourceMapEntrySchema = new mongoose.Schema({ from: { type: String }, to: { type: String } }, { _id: false });

// One entry per lead source (see lib/leadSources.js's LEAD_SOURCES, matched
// by `sourceSlug`) whose default column-alias mapping doesn't fit this
// company's actual export shape — e.g. their Meta export calls the name
// column "candidate_name" instead of the default "full_name"/"name". Only
// fields present in `mapping` override the source's own defaults; anything
// absent falls back to lib/leadSources.js as normal. Editable only by the
// super admin (see pages/api/companies/[id]/source-mappings.js).
const SourceColumnOverrideSchema = new mongoose.Schema(
  {
    sourceSlug: { type: String, required: true },
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// Per-company day-wise lead report emails — see lib/emailReports.js. Only
// the super admin edits this (pages/api/companies/[id]/email-reports.js).
// `recipients` has no upper bound; `dailyEnabled` gates the scheduled send
// (pages/api/cron/email-reports.js), which fires once per calendar day in
// `timezone` at or after `sendHour`. `lastScheduledDate` (a "YYYY-MM-DD"
// in that timezone) is what makes the cron idempotent — the endpoint can be
// hit as often as the host likes without ever double-sending a day.
const EmailReportConfigSchema = new mongoose.Schema(
  {
    recipients: { type: [String], default: [] },
    dailyEnabled: { type: Boolean, default: false },
    // Hour of day (0-23, in `timezone`) at/after which the daily send fires.
    sendHour: { type: Number, min: 0, max: 23, default: 9 },
    // Which day the automatic report covers: "yesterday" (the just-completed
    // day, for a morning send) or "today" (for an end-of-day send).
    coverage: { type: String, enum: ["yesterday", "today"], default: "yesterday" },
    // IANA zone the report's day boundaries and sendHour are interpreted in.
    timezone: { type: String, default: "Asia/Kolkata" },
    lastScheduledDate: { type: String, default: "" },
  },
  { _id: false }
);

// One connected Facebook Page (and, through it, any Instagram account that
// runs lead ads for that page). The webhook identifies a company by the
// Page ID Meta sends in each event, so a page can belong to exactly one
// company. The page access token is stored encrypted (lib/meta/crypto.js)
// and never leaves the server — the UI only ever sees `tokenPreview`.
const MetaPageSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    pageName: { type: String, default: "" },
    accessTokenEnc: { type: String, default: "" },
    tokenPreview: { type: String, default: "" }, // e.g. "EAAG…x9Qz"
    instagramAccountId: { type: String, default: "" },
    instagramUsername: { type: String, default: "" },
    subscribed: { type: Boolean, default: false }, // page subscribed to this app's leadgen webhook
    connectedVia: { type: String, enum: ["oauth", "manual", ""], default: "" },
    connectedBy: { type: String, default: "" }, // Facebook user name (oauth) or CRM username (manual)
    connectedAt: { type: Date },
    lastVerifiedAt: { type: Date },
    lastVerifyError: { type: String, default: "" },
  },
  { _id: true }
);

// Facebook Login for Business state. After the admin authorises the app,
// the callback stores every Page their Facebook account can manage here —
// each with its own encrypted Page token — until they pick one on the
// Meta Lead Ads page (connect-page moves it into `pages` above and clears
// this). Kept short-lived (`expiresAt`) so a half-finished connection does
// not leave usable tokens lying around. `fbUserName` is only for display
// ("Connected via John's Facebook").
const MetaPendingPageSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    pageName: { type: String, default: "" },
    accessTokenEnc: { type: String, default: "" },
    instagramAccountId: { type: String, default: "" },
    instagramUsername: { type: String, default: "" },
    tasks: { type: [String], default: [] },
  },
  { _id: false }
);

const MetaOAuthSchema = new mongoose.Schema(
  {
    fbUserId: { type: String, default: "" },
    fbUserName: { type: String, default: "" },
    authorizedAt: { type: Date },
    pendingPages: { type: [MetaPendingPageSchema], default: [] },
    expiresAt: { type: Date },
    grantedScopes: { type: [String], default: [] },
  },
  { _id: false }
);

const MetaConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    oauth: { type: MetaOAuthSchema, default: () => ({}) },
    connectionName: { type: String, default: "" },
    businessPortfolio: { type: String, default: "" },
    pages: { type: [MetaPageSchema], default: [] },
    lastWebhookAt: { type: Date },
    lastLeadAt: { type: Date },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date },
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
    // Per-company Lead Status/Source/Location filter overrides — empty on
    // every field below means "use the app-wide default," so a company that
    // never configures these is completely unaffected. See
    // lib/leadFields.js's effectiveStatuses/resolveLocation/applySourceMap.
    statusOptions: { type: [String], default: [] },
    sourceOptions: { type: [String], default: [] },
    sourceMap: { type: [SourceMapEntrySchema], default: [] },
    // Per-company, per-lead-source column-mapping overrides for the Excel
    // import page — see SourceColumnOverrideSchema above. Empty means every
    // source uses its default alias list from lib/leadSources.js unchanged.
    sourceColumnOverrides: { type: [SourceColumnOverrideSchema], default: [] },
    // Raw sheet-data field name (e.g. "city") to read a lead's location from
    // directly, bypassing normalizeShowroom()'s fixed 3-city classifier —
    // for a company whose real locations aren't Audi's showroom cities. This
    // is what a lead's own `location` value actually gets set to at sync
    // time — separate from locationOptions below, which only curates what
    // shows in the filter dropdown.
    locationField: { type: String, default: "" },
    // A fixed, hand-picked Location filter option list — takes priority over
    // auto-discovering every distinct value that's ever landed in
    // `location` (which, for messy raw ad-form data, can include a lot of
    // junk alongside the real place names). Empty falls back to the
    // discovered-distinct-value list when locationField is set, else the
    // app-wide default.
    locationOptions: { type: [String], default: [] },
    // 1440 = "Daily", for hosts (e.g. Vercel Hobby) where the sync can only
    // realistically run once a day — keeps the Online/Offline threshold accurate.
    syncIntervalMinutes: { type: Number, enum: [1, 5, 15, 1440], default: 1 },
    emailReports: { type: EmailReportConfigSchema, default: () => ({}) },
    // Meta Lead Ads connection — see MetaConfigSchema above and lib/meta/.
    meta: { type: MetaConfigSchema, default: () => ({}) },
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

// The webhook's first job is "which company owns this Page?" — one lookup
// per event, so the page id is indexed.
SettingsSchema.index({ "meta.pages.pageId": 1 });

module.exports = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
