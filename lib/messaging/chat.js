const mongoose = require("mongoose");
const Lead = require("../../models/Lead");
const Agent = require("../../models/Agent");
const Company = require("../../models/Company");
const Settings = require("../../models/Settings");
const MessageTemplate = require("../../models/MessageTemplate");
const WaConversation = require("../../models/WaConversation");
const WaMessage = require("../../models/WaMessage");
const { createAgentAssigner } = require("../syncService");
const { leadVariables } = require("./render");
const wa = require("./whatsappCloud");

// The WhatsApp inbox ("Chats"): two-way conversations on the company's
// official number. Inbound messages arrive from the webhook and are routed
// to the agent who owns the lead — or, for an unassigned / unknown
// customer, to the next agent by the same least-loaded, location-aware
// assignment that new sheet and Meta leads get. Agents reply from the
// Chats page; free text is allowed for 24 hours after the customer's last
// message (WhatsApp's customer-service window), after which only an
// approved template can re-open the conversation.

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Variants of a number as leads may have stored it (10 digits, 0-prefixed,
// or with the country code) so an inbound 91XXXXXXXXXX still matches.
function phoneVariants(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  const set = new Set([d]);
  if (d.length === 12 && d.startsWith("91")) {
    set.add(d.slice(2));
    set.add(`0${d.slice(2)}`);
  }
  if (d.length === 10) {
    set.add(`91${d}`);
    set.add(`0${d}`);
  }
  return [...set].filter(Boolean);
}

// How the CRM stores a phone on a lead: plain 10 digits for Indian numbers.
function storedPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
}

// The lead a conversation belongs to: the customer's most recent lead,
// preferring one that already has an agent so the chat stays with whoever
// is working the customer.
async function leadForPhone(companyId, digits) {
  const leads = await Lead.find({ companyId, phone: { $in: phoneVariants(digits) } })
    .select("_id name assignedTo canonicalModel location lastEnquiryAt createdAt whatsappOptOut")
    .sort({ lastEnquiryAt: -1, createdAt: -1 })
    .lean();
  return leads.find((l) => l.assignedTo) || leads[0] || null;
}

async function companyForPhoneNumberId(phoneNumberId) {
  const s = await Settings.findOne({ "messaging.whatsapp.phoneNumberId": phoneNumberId }).select("companyId").lean();
  return s?.companyId || null;
}

async function upsertConversation({ companyId, lead, phone, phoneNumberId }) {
  const conv = await WaConversation.findOneAndUpdate(
    { companyId, leadId: lead._id },
    { $setOnInsert: { companyId, leadId: lead._id, phone, phoneNumberId: phoneNumberId || "", lastMessageAt: new Date() }, $set: { assignedTo: lead.assignedTo || null } },
    { new: true, upsert: true }
  );
  return conv;
}

// Customer → company. Creates the lead if the number is unknown, assigns an
// agent if the lead has none, stores the message and bumps the unread
// count. Idempotent on Meta's message id.
async function recordInbound({ phoneNumberId, from, text, type, messageId, timestamp, profileName }) {
  const companyId = await companyForPhoneNumberId(phoneNumberId);
  if (!companyId) return { handled: false, reason: "unknown phone number id" };
  if (messageId && (await WaMessage.exists({ waMessageId: messageId }))) return { handled: true, duplicate: true, companyId };

  const digits = String(from).replace(/\D/g, "");
  let lead = await leadForPhone(companyId, digits);
  let created = false;
  const assignNext = await createAgentAssigner(new mongoose.Types.ObjectId(String(companyId)));
  if (!lead) {
    lead = await Lead.create({
      companyId,
      name: profileName || "",
      phone: storedPhone(digits),
      model: "WhatsApp",
      canonicalModel: "WhatsApp",
      source: "WhatsApp",
      status: "New",
      sheetCreatedAt: timestamp || new Date(),
      lastEnquiryAt: timestamp || new Date(),
      enquiryHistory: [{ model: "WhatsApp", date: timestamp || new Date(), source: "WhatsApp" }],
      assignedTo: assignNext() || null,
    });
    created = true;
  } else if (!lead.assignedTo) {
    const agentId = assignNext(lead.location);
    if (agentId) {
      await Lead.updateOne({ _id: lead._id }, { $set: { assignedTo: agentId } });
      lead.assignedTo = agentId;
    }
  }

  const conv = await upsertConversation({ companyId, lead, phone: digits, phoneNumberId });
  const body = String(text || (type && type !== "text" ? `[${type}]` : "")).slice(0, 4000);
  const msg = await WaMessage.create({
    companyId,
    conversationId: conv._id,
    leadId: lead._id,
    direction: "in",
    kind: type === "text" ? "text" : type ? "media" : "other",
    text: body,
    waMessageId: messageId || "",
    status: "received",
    timestamp: timestamp || new Date(),
  });
  await WaConversation.updateOne(
    { _id: conv._id },
    { $set: { lastMessageAt: msg.timestamp, lastMessageText: body, lastDirection: "in", lastInboundAt: msg.timestamp, archived: false, assignedTo: lead.assignedTo || null }, $inc: { unread: 1 } }
  );
  return { handled: true, companyId, leadId: lead._id, conversationId: conv._id, assignedTo: lead.assignedTo || null, created };
}

// Company → customer (agent reply, template, or campaign send).
async function recordOutbound({ companyId, lead, phone, phoneNumberId, text, kind = "text", agentId = null, sentBy = "", campaignId = null, waMessageId = "", status = "sent", timestamp }) {
  const conv = await upsertConversation({ companyId, lead, phone, phoneNumberId });
  const msg = await WaMessage.create({
    companyId,
    conversationId: conv._id,
    leadId: lead._id,
    direction: "out",
    kind,
    text: String(text || "").slice(0, 4000),
    agentId,
    sentBy,
    campaignId,
    waMessageId,
    status,
    timestamp: timestamp || new Date(),
  });
  await WaConversation.updateOne({ _id: conv._id }, { $set: { lastMessageAt: msg.timestamp, lastMessageText: msg.text, lastDirection: "out", archived: false } });
  return msg;
}

const STATUS_ORDER = { queued: 0, sent: 1, delivered: 2, read: 3 };
async function applyStatus({ messageId, status, error }) {
  if (!messageId) return false;
  const m = await WaMessage.findOne({ waMessageId: messageId }).select("status").lean();
  if (!m) return false;
  if (status === "failed") {
    await WaMessage.updateOne({ _id: m._id }, { $set: { status: "failed", error: error || "Delivery failed" } });
    return true;
  }
  if ((STATUS_ORDER[status] ?? -1) > (STATUS_ORDER[m.status] ?? -1)) await WaMessage.updateOne({ _id: m._id }, { $set: { status } });
  return true;
}

function windowOpen(conv) {
  return Boolean(conv?.lastInboundAt) && Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;
}

// Agent free-text reply — only inside the 24-hour window.
async function sendReply({ companyId, leadId, text, session }) {
  const { senderFor } = require("./engine");
  const body = String(text || "").trim();
  if (!body) throw new Error("Type a message first");
  const conv = await WaConversation.findOne({ companyId, leadId }).lean();
  const lead = await Lead.findOne({ _id: leadId, companyId }).select("_id name phone assignedTo whatsappOptOut").lean();
  if (!lead) throw new Error("Lead not found");
  if (!windowOpen(conv)) throw new Error("The 24-hour reply window has closed — send an approved template to re-open the conversation");
  const sender = await senderFor(companyId, "whatsapp");
  const to = conv?.phone || wa.toWaNumber(lead.phone);
  const id = await wa.sendText({ phoneNumberId: sender.phoneNumberId, token: sender.token, to, text: body });
  const msg = await recordOutbound({ companyId, lead, phone: to, phoneNumberId: sender.phoneNumberId, text: body, kind: "text", agentId: session?.agentId || null, sentBy: session?.name || session?.username || "", waMessageId: id });
  return msg;
}

// Re-open (or start) a conversation with an approved template, rendered
// with the lead's own variables.
async function sendTemplateToLead({ companyId, leadId, templateId, session }) {
  const { senderFor } = require("./engine");
  const template = await MessageTemplate.findOne({ _id: templateId, companyId, channel: "whatsapp", archived: { $ne: true } }).lean();
  if (!template) throw new Error("Template not found");
  if (template.waStatus && template.waStatus !== "APPROVED") throw new Error(`Template is ${template.waStatus.toLowerCase()} — only approved templates can be sent`);
  const lead = await Lead.findOne({ _id: leadId, companyId }).lean();
  if (!lead) throw new Error("Lead not found");
  if (lead.whatsappOptOut) throw new Error("This customer has opted out of WhatsApp messages");
  const sender = await senderFor(companyId, "whatsapp");
  const [company, agent] = await Promise.all([Company.findById(companyId).lean(), lead.assignedTo ? Agent.findById(lead.assignedTo).select("name phone").lean() : null]);
  const vars = leadVariables({ lead, agent, company });
  const bodyParams = (template.waBodyParams || []).map((k) => vars[k] ?? "");
  const headerParam = template.waHeaderParam ? vars[template.waHeaderParam] ?? "" : undefined;
  const to = wa.toWaNumber(lead.phone);
  if (!to) throw new Error("Lead has no phone number");
  const id = await wa.sendTemplate({ phoneNumberId: sender.phoneNumberId, token: sender.token, to, templateName: template.waName, language: template.waLanguage || "en", bodyParams, headerParam });
  const rendered = String(template.body || "").replace(/\{\{(\d+)\}\}/g, (_, n) => bodyParams[Number(n) - 1] ?? "");
  return recordOutbound({ companyId, lead, phone: to, phoneNumberId: sender.phoneNumberId, text: rendered, kind: "template", agentId: session?.agentId || null, sentBy: session?.name || session?.username || "", waMessageId: id });
}

function scopeFilter(companyId, session) {
  const f = { companyId };
  if (session?.role === "agent") f.assignedTo = session.agentId;
  return f;
}

async function listConversations({ companyId, session, q = "", box = "all", limit = 100 }) {
  const filter = { ...scopeFilter(companyId, session), archived: { $ne: true } };
  if (box === "unread") filter.unread = { $gt: 0 };
  if (box === "unassigned") filter.assignedTo = null;
  if (q.trim()) {
    const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leadIds = await Lead.find({ companyId, $or: [{ name: { $regex: safe, $options: "i" } }, { phone: { $regex: safe } }] }).select("_id").limit(500).lean();
    filter.$or = [{ leadId: { $in: leadIds.map((l) => l._id) } }, { phone: { $regex: safe } }];
  }
  const convs = await WaConversation.find(filter).sort({ lastMessageAt: -1 }).limit(limit).populate("leadId", "name phone canonicalModel status location whatsappOptOut").populate("assignedTo", "name").lean();
  return convs.map((c) => ({
    _id: c._id,
    leadId: c.leadId?._id || c.leadId,
    lead: c.leadId && c.leadId.name !== undefined ? c.leadId : null,
    phone: c.phone,
    agent: c.assignedTo ? { _id: c.assignedTo._id, name: c.assignedTo.name } : null,
    lastMessageAt: c.lastMessageAt,
    lastMessageText: c.lastMessageText,
    lastDirection: c.lastDirection,
    unread: c.unread || 0,
    windowOpen: windowOpen(c),
    windowClosesAt: c.lastInboundAt ? new Date(new Date(c.lastInboundAt).getTime() + WINDOW_MS) : null,
  }));
}

async function getThread({ companyId, session, leadId, markRead = true }) {
  const conv = await WaConversation.findOne({ ...scopeFilter(companyId, session), leadId }).populate("leadId", "name phone email canonicalModel status location assignedTo whatsappOptOut").populate("assignedTo", "name").lean();
  if (!conv) return null;
  const messages = await WaMessage.find({ conversationId: conv._id }).sort({ timestamp: 1 }).limit(500).lean();
  if (markRead && conv.unread) await WaConversation.updateOne({ _id: conv._id }, { $set: { unread: 0 } });
  return {
    conversation: { _id: conv._id, leadId: conv.leadId?._id || conv.leadId, phone: conv.phone, agent: conv.assignedTo ? { _id: conv.assignedTo._id, name: conv.assignedTo.name } : null, windowOpen: windowOpen(conv), windowClosesAt: conv.lastInboundAt ? new Date(new Date(conv.lastInboundAt).getTime() + WINDOW_MS) : null, unread: markRead ? 0 : conv.unread },
    lead: conv.leadId && conv.leadId.name !== undefined ? conv.leadId : null,
    messages,
  };
}

async function unreadCount({ companyId, session }) {
  // aggregate() doesn't cast string ids, so build the match by hand.
  const match = { companyId: new mongoose.Types.ObjectId(String(companyId)), archived: { $ne: true }, unread: { $gt: 0 } };
  if (session?.role === "agent") match.assignedTo = new mongoose.Types.ObjectId(String(session.agentId));
  const r = await WaConversation.aggregate([{ $match: match }, { $group: { _id: null, conversations: { $sum: 1 }, messages: { $sum: "$unread" } } }]);
  return { conversations: r[0]?.conversations || 0, messages: r[0]?.messages || 0 };
}

async function reassign({ companyId, leadId, agentId }) {
  const agent = agentId ? await Agent.findOne({ _id: agentId, companyId }).select("_id").lean() : null;
  if (agentId && !agent) throw new Error("Agent not found");
  await Lead.updateOne({ _id: leadId, companyId }, { $set: { assignedTo: agent ? agent._id : null } });
  await WaConversation.updateOne({ companyId, leadId }, { $set: { assignedTo: agent ? agent._id : null } });
  return true;
}

module.exports = { recordInbound, recordOutbound, applyStatus, sendReply, sendTemplateToLead, listConversations, getThread, unreadCount, reassign, windowOpen, phoneVariants, storedPhone, WINDOW_MS };
