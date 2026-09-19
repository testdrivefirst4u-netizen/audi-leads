const Campaign = require("../../models/Campaign");
const CampaignMessage = require("../../models/CampaignMessage");
const MessageTemplate = require("../../models/MessageTemplate");
const Lead = require("../../models/Lead");
const Agent = require("../../models/Agent");
const Company = require("../../models/Company");
const Settings = require("../../models/Settings");
const { decryptSecret } = require("../meta/crypto");
const { audienceFilter } = require("./audience");
const { leadVariables, renderText, renderEmail, unsubscribeUrl, sampleVariables } = require("./render");
const wa = require("./whatsappCloud");
const { sendCampaignEmail } = require("./email");

// The campaign sending engine.
//
//   startCampaign(id)         — materialise the audience into CampaignMessage
//                               rows (status "queued"), status → sending
//   processCampaign(id, n)    — send up to n queued rows using the company's
//                               own WhatsApp number / email sender; each
//                               call is short so it fits a serverless
//                               request; call repeatedly until done
//   runDueCampaigns()         — cron entry: start scheduled campaigns whose
//                               time has come and push every sending one
//                               forward by a batch
//
// Rules applied at send time (not just at enqueue): quiet hours in the
// company's timezone, the per-lead weekly cap, and per-channel opt-out —
// a customer who opted out between enqueue and send is skipped.

const BATCH_DEFAULT = 50;
const MAX_ATTEMPTS = 3;

function hourInTz(timeZone) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

function inQuietHours(m) {
  const h = hourInTz(m?.timezone || "Asia/Kolkata");
  const start = Number.isInteger(m?.quietHoursStart) ? m.quietHoursStart : 21;
  const end = Number.isInteger(m?.quietHoursEnd) ? m.quietHoursEnd : 9;
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

async function senderFor(companyId, channel) {
  const settings = await Settings.findOne({ companyId }).select("messaging").lean();
  const m = settings?.messaging || {};
  if (channel === "whatsapp") {
    const w = m.whatsapp || {};
    if (!w.phoneNumberId || !w.accessTokenEnc) throw new Error("WhatsApp is not connected for this company (Companies → Messaging)");
    return { messaging: m, phoneNumberId: w.phoneNumberId, token: decryptSecret(w.accessTokenEnc) };
  }
  const e = m.email || {};
  if (!e.fromEmail) throw new Error("Email sender is not set for this company (Companies → Messaging)");
  return {
    messaging: m,
    fromName: e.fromName || "",
    fromEmail: e.fromEmail,
    replyTo: e.replyTo || "",
    apiKey: e.brevoApiKeyEnc ? decryptSecret(e.brevoApiKeyEnc) : "",
  };
}

async function startCampaign(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (!["draft", "scheduled"].includes(campaign.status)) return campaign;
  const template = await MessageTemplate.findById(campaign.templateId).lean();
  if (!template) throw new Error("Template not found");
  if (campaign.channel === "whatsapp" && template.waStatus && template.waStatus !== "APPROVED") {
    throw new Error(`WhatsApp template "${template.waName}" is ${template.waStatus.toLowerCase()} — only approved templates can be sent`);
  }
  await senderFor(campaign.companyId, campaign.channel); // throws if the company can't send on this channel

  const filter = audienceFilter(campaign.companyId, campaign.channel, campaign.audience);
  const leads = await Lead.find(filter).select("_id phone email").lean();

  // One message per contact address — a customer with two leads (two
  // models) still gets one message.
  const seen = new Set();
  const docs = [];
  let skipped = 0;
  for (const l of leads) {
    const to = campaign.channel === "whatsapp" ? wa.toWaNumber(l.phone) : String(l.email || "").trim().toLowerCase();
    if (!to || seen.has(to)) {
      skipped++;
      continue;
    }
    seen.add(to);
    docs.push({ campaignId: campaign._id, companyId: campaign.companyId, leadId: l._id, channel: campaign.channel, to, status: "queued" });
  }
  if (docs.length) await CampaignMessage.insertMany(docs, { ordered: false });

  campaign.status = "sending";
  campaign.startedAt = new Date();
  campaign.templateSnapshot = template;
  campaign.stats.audience = leads.length;
  campaign.stats.queued = docs.length;
  campaign.stats.skipped = skipped;
  campaign.lastError = "";
  await campaign.save();
  return campaign;
}

async function bumpStat(campaignId, field, by = 1) {
  await Campaign.updateOne({ _id: campaignId }, { $inc: { [`stats.${field}`]: by } });
}

// Sends up to `limit` queued messages. Returns { sent, failed, skipped, remaining, paused }.
async function processCampaign(campaignId, limit = BATCH_DEFAULT) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== "sending") return { sent: 0, failed: 0, skipped: 0, remaining: 0, paused: campaign?.status === "paused" };
  const template = campaign.templateSnapshot || (await MessageTemplate.findById(campaign.templateId).lean());
  const company = await Company.findById(campaign.companyId).lean();

  let sender;
  try {
    sender = await senderFor(campaign.companyId, campaign.channel);
  } catch (err) {
    campaign.status = "failed";
    campaign.lastError = err.message;
    await campaign.save();
    return { sent: 0, failed: 0, skipped: 0, remaining: 0, error: err.message };
  }
  if (inQuietHours(sender.messaging)) {
    const remaining = await CampaignMessage.countDocuments({ campaignId, status: "queued" });
    return { sent: 0, failed: 0, skipped: 0, remaining, quietHours: true };
  }

  const batch = await CampaignMessage.find({ campaignId, status: "queued", attempts: { $lt: MAX_ATTEMPTS } }).limit(limit).lean();
  const leadIds = batch.map((m) => m.leadId);
  const leads = await Lead.find({ _id: { $in: leadIds } }).lean();
  const leadById = new Map(leads.map((l) => [String(l._id), l]));
  const agentIds = [...new Set(leads.map((l) => l.assignedTo && String(l.assignedTo)).filter(Boolean))];
  const agents = agentIds.length ? await Agent.find({ _id: { $in: agentIds } }).select("name phone").lean() : [];
  const agentById = new Map(agents.map((a) => [String(a._id), a]));
  const weeklyCap = Number(sender.messaging?.weeklyCap ?? 2);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const baseUrl = process.env.META_WEBHOOK_URL ? new URL(process.env.META_WEBHOOK_URL).origin : "https://sales.broaddcast.com";

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const m of batch) {
    const lead = leadById.get(String(m.leadId));
    const optedOut = !lead || (campaign.channel === "whatsapp" ? lead.whatsappOptOut : lead.emailOptOut);
    if (optedOut) {
      await CampaignMessage.updateOne({ _id: m._id }, { $set: { status: "skipped", skipReason: lead ? "Opted out" : "Lead deleted" } });
      skipped++;
      continue;
    }
    if (weeklyCap > 0) {
      const recent = await CampaignMessage.countDocuments({ companyId: campaign.companyId, channel: campaign.channel, leadId: m.leadId, sentAt: { $gte: weekAgo }, status: { $nin: ["failed", "skipped", "queued"] } });
      if (recent >= weeklyCap) {
        await CampaignMessage.updateOne({ _id: m._id }, { $set: { status: "skipped", skipReason: `Weekly cap (${weeklyCap}) reached` } });
        skipped++;
        continue;
      }
    }

    const vars = leadVariables({ lead, agent: lead.assignedTo ? agentById.get(String(lead.assignedTo)) : null, company });
    try {
      let providerMessageId = "";
      let rendered = "";
      if (campaign.channel === "whatsapp") {
        const bodyParams = (template.waBodyParams || []).map((k) => vars[k] ?? "");
        const headerParam = template.waHeaderParam ? vars[template.waHeaderParam] ?? "" : undefined;
        providerMessageId = await wa.sendTemplate({ phoneNumberId: sender.phoneNumberId, token: sender.token, to: m.to, templateName: template.waName, language: template.waLanguage || "en", bodyParams, headerParam });
        rendered = String(template.body || "").replace(/\{\{(\d+)\}\}/g, (_, n) => bodyParams[Number(n) - 1] ?? "");
        try {
          await require("./chat").recordOutbound({ companyId: campaign.companyId, lead, phone: m.to, phoneNumberId: sender.phoneNumberId, text: rendered, kind: "template", sentBy: `Campaign: ${campaign.name}`, campaignId: campaign._id, waMessageId: providerMessageId });
        } catch (e) {
          console.warn("[campaigns] could not record chat message:", e.message);
        }
      } else {
        const unsubscribe = unsubscribeUrl(baseUrl, lead._id, campaign.companyId);
        const { subject, html, text } = renderEmail({ template, vars, company, unsubscribe });
        const r = await sendCampaignEmail({
          apiKey: sender.apiKey,
          fromName: sender.fromName || company?.name || "",
          fromEmail: sender.fromEmail,
          replyTo: sender.replyTo,
          to: m.to,
          toName: lead.name || "",
          subject,
          html,
          text,
          tags: [`campaign:${campaign._id}`, `company:${campaign.companyId}`],
          headers: { "List-Unsubscribe": `<${unsubscribe}>`, "X-Campaign-Id": String(campaign._id), "X-Message-Id": String(m._id) },
        });
        providerMessageId = r.providerMessageId;
        rendered = subject;
      }
      await CampaignMessage.updateOne({ _id: m._id }, { $set: { status: "sent", providerMessageId, rendered, sentAt: new Date(), error: "" }, $inc: { attempts: 1 } });
      await Lead.updateOne({ _id: lead._id }, { $set: { lastMarketingAt: new Date() } });
      sent++;
    } catch (err) {
      const attempts = (m.attempts || 0) + 1;
      const permanent = attempts >= MAX_ATTEMPTS || /invalid|not a valid|template|param|recipient|unsubscribed|blocked|131026|131047|132000/i.test(err.message);
      await CampaignMessage.updateOne(
        { _id: m._id },
        { $set: { error: err.message.slice(0, 400), ...(permanent ? { status: "failed" } : {}) }, $inc: { attempts: 1 } }
      );
      if (permanent) failed++;
      // Auth / config errors stop the campaign rather than failing every row.
      if (/token|OAuth|permission|not connected|not set|api key|unauthori[sz]ed/i.test(err.message) && attempts === 1) {
        await Campaign.updateOne({ _id: campaign._id }, { $set: { status: "paused", lastError: err.message.slice(0, 400) } });
        await bumpStat(campaign._id, "sent", sent);
        await bumpStat(campaign._id, "failed", failed);
        await bumpStat(campaign._id, "skipped", skipped);
        return { sent, failed, skipped, remaining: await CampaignMessage.countDocuments({ campaignId, status: "queued" }), paused: true, error: err.message };
      }
    }
  }

  await bumpStat(campaign._id, "sent", sent);
  await bumpStat(campaign._id, "failed", failed);
  await bumpStat(campaign._id, "skipped", skipped);
  const remaining = await CampaignMessage.countDocuments({ campaignId, status: "queued", attempts: { $lt: MAX_ATTEMPTS } });
  if (remaining === 0) {
    // Anything that hit MAX_ATTEMPTS without being marked stays "queued";
    // count it as failed and close the campaign.
    const stuck = await CampaignMessage.updateMany({ campaignId, status: "queued" }, { $set: { status: "failed" } });
    if (stuck.modifiedCount) await bumpStat(campaign._id, "failed", stuck.modifiedCount);
    await Campaign.updateOne({ _id: campaign._id }, { $set: { status: "done", finishedAt: new Date() } });
  }
  return { sent, failed, skipped, remaining };
}

async function runDueCampaigns({ batch = BATCH_DEFAULT } = {}) {
  const now = new Date();
  const due = await Campaign.find({ status: "scheduled", scheduledAt: { $lte: now } }).select("_id").lean();
  for (const c of due) {
    try {
      await startCampaign(c._id);
    } catch (err) {
      await Campaign.updateOne({ _id: c._id }, { $set: { status: "failed", lastError: err.message } });
    }
  }
  const sending = await Campaign.find({ status: "sending" }).select("_id").lean();
  const results = [];
  for (const c of sending) results.push({ id: String(c._id), ...(await processCampaign(c._id, batch)) });
  return { started: due.length, processed: results };
}

// Sends one template to an arbitrary number / email with sample variable
// values — the "Send test" button on the Templates tab, so an admin can see
// exactly how a template looks on a phone before using it in a campaign.
// Nothing is recorded against a lead.
async function sendTestMessage({ companyId, template, to, vars }) {
  const sender = await senderFor(companyId, template.channel);
  const company = await Company.findById(companyId).lean();
  const v = { ...sampleVariables(company), ...(vars || {}) };
  if (template.channel === "whatsapp") {
    const number = wa.toWaNumber(to);
    if (!number || number.length < 11) throw new Error("Enter the phone number with country code, e.g. 91 98765 43210");
    const bodyParams = (template.waBodyParams || []).map((k) => v[k] ?? "");
    const headerParam = template.waHeaderParam ? v[template.waHeaderParam] ?? "" : undefined;
    const id = await wa.sendTemplate({ phoneNumberId: sender.phoneNumberId, token: sender.token, to: number, templateName: template.waName, language: template.waLanguage || "en", bodyParams, headerParam });
    return { to: number, providerMessageId: id, rendered: String(template.body || "").replace(/\{\{(\d+)\}\}/g, (_, n) => bodyParams[Number(n) - 1] ?? "") };
  }
  const email = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  const baseUrl = process.env.META_WEBHOOK_URL ? new URL(process.env.META_WEBHOOK_URL).origin : "https://sales.broaddcast.com";
  const { subject, html, text } = renderEmail({ template, vars: v, company, unsubscribe: `${baseUrl}/api/messaging/unsubscribe?t=test` });
  const r = await sendCampaignEmail({ apiKey: sender.apiKey, fromName: sender.fromName || company?.name || "", fromEmail: sender.fromEmail, replyTo: sender.replyTo, to: email, subject: `[TEST] ${subject}`, html, text, tags: ["test"], headers: {} });
  return { to: email, providerMessageId: r.providerMessageId, rendered: subject };
}

// ---- webhook helpers ---------------------------------------------------------

async function applyWhatsAppStatus({ messageId, status, timestamp, error }) {
  const m = await CampaignMessage.findOne({ providerMessageId: messageId });
  if (!m) return false;
  const order = { queued: 0, sent: 1, delivered: 2, read: 3, replied: 4 };
  const update = {};
  if (status === "failed") {
    if (m.status !== "failed") {
      update.status = "failed";
      update.error = error || "Delivery failed";
      await bumpStat(m.campaignId, "failed");
    }
  } else if ((order[status] ?? -1) > (order[m.status] ?? 0)) {
    update.status = status;
    if (status === "delivered") {
      update.deliveredAt = timestamp;
      await bumpStat(m.campaignId, "delivered");
    }
    if (status === "read") {
      update.readAt = timestamp;
      if (!m.deliveredAt) {
        update.deliveredAt = timestamp;
        await bumpStat(m.campaignId, "delivered");
      }
      await bumpStat(m.campaignId, "read");
    }
  }
  if (Object.keys(update).length) await CampaignMessage.updateOne({ _id: m._id }, { $set: update });
  return true;
}

// An inbound WhatsApp message from a customer: STOP → opt out; otherwise a
// reply on the most recent campaign message to that number (if any) and a
// note on the lead's timeline either way.
async function applyWhatsAppInbound({ phoneNumberId, from, text, timestamp }) {
  const settings = await Settings.findOne({ "messaging.whatsapp.phoneNumberId": phoneNumberId }).select("companyId").lean();
  if (!settings) return { handled: false, reason: "unknown phone number id" };
  const companyId = settings.companyId;
  const digits = String(from).replace(/\D/g, "");
  const leads = await Lead.find({ companyId, phone: { $in: [digits, digits.replace(/^91/, ""), `0${digits.replace(/^91/, "")}`] } }).select("_id").lean();
  const leadIds = leads.map((l) => l._id);
  const optOut = wa.isOptOutText(text);

  if (optOut && leadIds.length) {
    await Lead.updateMany({ _id: { $in: leadIds } }, { $set: { whatsappOptOut: true, whatsappOptOutAt: timestamp } });
  }
  const last = await CampaignMessage.findOne({ companyId, channel: "whatsapp", to: digits, status: { $nin: ["queued", "skipped"] } }).sort({ sentAt: -1 });
  if (last && !last.repliedAt) {
    await CampaignMessage.updateOne({ _id: last._id }, { $set: { status: "replied", repliedAt: timestamp, replyText: String(text || "").slice(0, 500) } });
    await bumpStat(last.campaignId, "replied");
    if (optOut) await bumpStat(last.campaignId, "optedOut");
  }
  if (leadIds.length && text) {
    await Lead.updateMany(
      { _id: { $in: leadIds } },
      { $push: { remarks: { text: `WhatsApp reply: ${String(text).slice(0, 500)}${optOut ? " (opted out)" : ""}`, createdAt: timestamp } } }
    );
  }
  return { handled: true, companyId, leads: leadIds.length, optOut };
}

async function applyEmailEvent({ event, messageId, email, timestamp, reason }) {
  let m = messageId ? await CampaignMessage.findOne({ providerMessageId: messageId }) : null;
  if (!m && email) m = await CampaignMessage.findOne({ channel: "email", to: String(email).toLowerCase(), status: { $nin: ["queued", "skipped"] } }).sort({ sentAt: -1 });
  if (!m) return false;
  const set = {};
  switch (event) {
    case "delivered":
      if (m.status === "sent") {
        set.status = "delivered";
        set.deliveredAt = timestamp;
        await bumpStat(m.campaignId, "delivered");
      }
      break;
    case "opened":
    case "unique_opened":
      if (!m.readAt) {
        set.readAt = timestamp;
        if (["sent", "delivered"].includes(m.status)) set.status = "opened";
        await bumpStat(m.campaignId, "opened");
      }
      break;
    case "click":
      set.status = "clicked";
      await bumpStat(m.campaignId, "clicked");
      break;
    case "hard_bounce":
    case "soft_bounce":
    case "blocked":
    case "invalid_email":
    case "error":
      if (m.status !== "bounced") {
        set.status = "bounced";
        set.error = reason || event;
        await bumpStat(m.campaignId, "bounced");
      }
      break;
    case "unsubscribed":
    case "spam":
      await Lead.updateOne({ _id: m.leadId }, { $set: { emailOptOut: true, emailOptOutAt: timestamp } });
      await bumpStat(m.campaignId, "optedOut");
      break;
    default:
      break;
  }
  if (Object.keys(set).length) await CampaignMessage.updateOne({ _id: m._id }, { $set: set });
  return true;
}

module.exports = { startCampaign, processCampaign, runDueCampaigns, applyWhatsAppStatus, applyWhatsAppInbound, applyEmailEvent, inQuietHours, senderFor, sendTestMessage };
