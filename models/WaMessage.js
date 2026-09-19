const mongoose = require("mongoose");

// Every WhatsApp message in or out on a company number — inbound customer
// messages, agent replies from the Chats page, and campaign templates —
// so a conversation thread shows the whole history in one place.
const WaMessageSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "WaConversation", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    kind: { type: String, enum: ["text", "template", "media", "other"], default: "text" },
    text: { type: String, default: "" },
    // Outbound: who sent it (agent) — null for campaign / system sends.
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
    sentBy: { type: String, default: "" }, // display name / "Campaign: …"
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
    waMessageId: { type: String, default: "" }, // wamid.… from Meta (both directions)
    status: { type: String, enum: ["received", "queued", "sent", "delivered", "read", "failed"], default: "received" },
    error: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

WaMessageSchema.index({ waMessageId: 1 }, { unique: true, sparse: true, partialFilterExpression: { waMessageId: { $type: "string", $gt: "" } } });
WaMessageSchema.index({ conversationId: 1, timestamp: 1 });

module.exports = mongoose.models.WaMessage || mongoose.model("WaMessage", WaMessageSchema);
