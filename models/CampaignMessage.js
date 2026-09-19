const mongoose = require("mongoose");

// One recipient of one campaign. Created when the campaign is started
// (status "queued"), sent by the engine in batches, then advanced by the
// provider's delivery webhooks (WhatsApp: sent → delivered → read / failed;
// email: sent → delivered → opened → clicked / bounced). `providerMessageId`
// is how a webhook event finds its row. A customer reply or STOP within the
// campaign window is recorded here too, and mirrored onto the lead.
const CampaignMessageSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    to: { type: String, required: true }, // E.164 digits for WhatsApp, address for email
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "opened", "clicked", "replied", "failed", "bounced", "skipped"],
      default: "queued",
      index: true,
    },
    skipReason: { type: String, default: "" },
    providerMessageId: { type: String, index: true, sparse: true },
    error: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    rendered: { type: String, default: "" }, // what was actually sent (text / subject), for the timeline
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    repliedAt: { type: Date },
    replyText: { type: String, default: "" },
  },
  { timestamps: true }
);

CampaignMessageSchema.index({ campaignId: 1, status: 1 });
CampaignMessageSchema.index({ leadId: 1, createdAt: -1 });
// "Recently messaged on this channel" exclusion + frequency caps.
CampaignMessageSchema.index({ companyId: 1, channel: 1, leadId: 1, sentAt: -1 });

module.exports = mongoose.models.CampaignMessage || mongoose.model("CampaignMessage", CampaignMessageSchema);
