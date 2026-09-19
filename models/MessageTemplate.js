const mongoose = require("mongoose");

// A reusable message per company and channel. Variables are written as
// {{name}}, {{first_name}}, {{model}}, {{agent}}, {{agent_phone}},
// {{company}}, {{showroom}} and filled from the lead at send time (see
// lib/messaging/render.js).
//
// WhatsApp marketing messages must be sent as Meta-approved templates, so a
// WhatsApp template here mirrors one in the company's WhatsApp Business
// Account: `waName` + `waLanguage` identify it and `waBodyParams` says
// which lead variable fills each numbered {{1}}, {{2}}… placeholder. `body`
// keeps a copy of the approved text purely for preview. Email templates are
// free-form (subject + HTML/text body) and always get an unsubscribe link.
const MessageTemplateSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    name: { type: String, required: true },
    // Email
    subject: { type: String, default: "" },
    body: { type: String, default: "" }, // email: HTML or plain text; whatsapp: preview text of the approved template
    // WhatsApp (Cloud API)
    waName: { type: String, default: "" },
    waLanguage: { type: String, default: "en" },
    waStatus: { type: String, default: "" }, // APPROVED / PENDING / REJECTED / "" (not synced)
    waCategory: { type: String, default: "" }, // MARKETING / UTILITY
    waBodyParams: { type: [String], default: [] }, // e.g. ["first_name", "model"] -> {{1}}, {{2}}
    waHeaderParam: { type: String, default: "" }, // optional variable for a text header
    archived: { type: Boolean, default: false },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

MessageTemplateSchema.index({ companyId: 1, channel: 1, archived: 1 });

module.exports = mongoose.models.MessageTemplate || mongoose.model("MessageTemplate", MessageTemplateSchema);
