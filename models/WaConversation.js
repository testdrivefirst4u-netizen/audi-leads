const mongoose = require("mongoose");

// One WhatsApp conversation per lead on the company's official number —
// the row in the Chats inbox. Denormalised so the inbox list is one cheap
// query: last message, unread count, assigned agent (kept in step with
// lead.assignedTo), and the time of the customer's last message, which is
// what decides whether a free-text reply is allowed (24-hour window) or a
// template is required.
const WaConversationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    phone: { type: String, required: true }, // E.164 digits, e.g. 919876543210
    phoneNumberId: { type: String, default: "" }, // the company number it happened on
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessageText: { type: String, default: "" },
    lastDirection: { type: String, enum: ["in", "out"], default: "in" },
    lastInboundAt: { type: Date, default: null },
    unread: { type: Number, default: 0 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

WaConversationSchema.index({ companyId: 1, leadId: 1 }, { unique: true });
WaConversationSchema.index({ companyId: 1, lastMessageAt: -1 });
WaConversationSchema.index({ companyId: 1, assignedTo: 1, unread: 1 });

module.exports = mongoose.models.WaConversation || mongoose.model("WaConversation", WaConversationSchema);
