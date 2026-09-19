const mongoose = require("mongoose");

// One marketing send-out for one company over one channel. The audience is
// stored as the same filter vocabulary the Leads page uses (model, status,
// source, platform, location, agent, bucket, created-date range) plus the
// exclusions every campaign applies (opted out, recently messaged, no
// contact detail), so "who will get this" is always reproducible from the
// campaign itself. Recipients are materialised into CampaignMessage rows
// when the campaign starts; `stats` is a denormalised roll-up of those rows
// kept current by the sending engine and the delivery webhooks.
//
// Status lifecycle: draft → scheduled → sending → done  (or paused / failed)
const AudienceSchema = new mongoose.Schema(
  {
    model: { type: String, default: "" },
    status: { type: String, default: "" },
    source: { type: String, default: "" },
    platform: { type: String, default: "" }, // facebook | instagram | other
    location: { type: String, default: "" },
    agent: { type: String, default: "" }, // agent id or "unassigned"
    bucket: { type: String, default: "" },
    from: { type: String, default: "" }, // YYYY-MM-DD on sheetCreatedAt
    to: { type: String, default: "" },
    search: { type: String, default: "" },
    // Exclusions
    excludeMessagedDays: { type: Number, default: 7 }, // skip anyone messaged on this channel in the last N days (0 = don't skip)
    excludeStatuses: { type: [String], default: [] },
  },
  { _id: false }
);

const CampaignStatsSchema = new mongoose.Schema(
  {
    audience: { type: Number, default: 0 }, // matched the filter
    queued: { type: Number, default: 0 }, // rows created
    skipped: { type: Number, default: 0 }, // opted out / no phone / no email at enqueue time
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    replied: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    optedOut: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true },
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "MessageTemplate", required: true },
    audience: { type: AudienceSchema, default: () => ({}) },
    status: { type: String, enum: ["draft", "scheduled", "sending", "paused", "done", "failed"], default: "draft", index: true },
    scheduledAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    lastError: { type: String, default: "" },
    stats: { type: CampaignStatsSchema, default: () => ({}) },
    createdBy: { type: String, default: "" },
    // Snapshot of the template at send time, so editing the template later
    // doesn't change what a past campaign shows as "what we sent".
    templateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

CampaignSchema.index({ companyId: 1, createdAt: -1 });
CampaignSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.models.Campaign || mongoose.model("Campaign", CampaignSchema);
