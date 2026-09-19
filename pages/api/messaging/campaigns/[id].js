const connectDB = require("../../../../lib/db");
const Campaign = require("../../../../models/Campaign");
const CampaignMessage = require("../../../../models/CampaignMessage");
const MessageTemplate = require("../../../../models/MessageTemplate");
const Company = require("../../../../models/Company");
const { requireAdminOrSuperAdmin } = require("../../../../lib/auth");
const { previewAudience, cleanAudience } = require("../../../../lib/messaging/audience");
const { startCampaign, processCampaign } = require("../../../../lib/messaging/engine");
const { renderText, sampleVariables } = require("../../../../lib/messaging/render");

// One campaign.
//   GET                     → campaign + template + live audience preview
//                             (draft/scheduled) or message list (sending/done)
//                             ?page= &status= for the message list
//   PATCH                   → edit a draft { name, templateId, audience }
//   POST ?action=send       → start now (materialise audience, status sending)
//                             and send the first batch
//   POST ?action=schedule   → { scheduledAt } → status scheduled
//   POST ?action=process    → send the next batch (the report page calls
//                             this repeatedly while the campaign is sending)
//   POST ?action=pause | resume | cancel
//   DELETE                  → delete a draft / scheduled campaign

const PAGE_SIZE = 50;

async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;
  const campaign = await Campaign.findOne({ _id: req.query.id, companyId });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (req.method === "GET") {
    const template = campaign.templateSnapshot || (await MessageTemplate.findById(campaign.templateId).lean());
    const company = await Company.findById(companyId).select("name").lean();
    const out = { campaign: campaign.toObject(), template };
    if (template) out.sampleRender = { subject: renderText(template.subject, sampleVariables(company)), body: renderText(template.body, sampleVariables(company)) };
    if (["draft", "scheduled"].includes(campaign.status)) {
      out.preview = await previewAudience(companyId, campaign.channel, campaign.audience);
    } else {
      const page = Math.max(1, Number(req.query.page) || 1);
      const filter = { campaignId: campaign._id, ...(req.query.status ? { status: req.query.status } : {}) };
      const [messages, total, byStatus] = await Promise.all([
        CampaignMessage.find(filter).sort({ sentAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("leadId", "name phone email canonicalModel status").lean(),
        CampaignMessage.countDocuments(filter),
        CampaignMessage.aggregate([{ $match: { campaignId: campaign._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      ]);
      out.messages = messages.map((m) => ({ ...m, lead: m.leadId, leadId: m.leadId?._id || m.leadId }));
      out.messagesTotal = total;
      out.page = page;
      out.pageSize = PAGE_SIZE;
      out.byStatus = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    }
    return res.status(200).json(out);
  }

  if (req.method === "PATCH") {
    if (!["draft", "scheduled"].includes(campaign.status)) return res.status(409).json({ error: "Only draft or scheduled campaigns can be edited" });
    const b = req.body || {};
    if (typeof b.name === "string" && b.name.trim()) campaign.name = b.name.trim();
    if (b.templateId) {
      const t = await MessageTemplate.findOne({ _id: b.templateId, companyId, channel: campaign.channel, archived: { $ne: true } }).select("_id").lean();
      if (!t) return res.status(400).json({ error: "Template not found for this channel" });
      campaign.templateId = t._id;
    }
    if (b.audience && typeof b.audience === "object") {
      campaign.audience = cleanAudience(b.audience);
    }
    await campaign.save();
    return res.status(200).json({ campaign });
  }

  if (req.method === "DELETE") {
    if (!["draft", "scheduled", "failed"].includes(campaign.status)) return res.status(409).json({ error: "A campaign that has started sending cannot be deleted" });
    await CampaignMessage.deleteMany({ campaignId: campaign._id });
    await campaign.deleteOne();
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, PATCH, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.query.action;
  try {
    if (action === "send") {
      if (!["draft", "scheduled"].includes(campaign.status)) return res.status(409).json({ error: `Campaign is already ${campaign.status}` });
      const started = await startCampaign(campaign._id);
      const batch = await processCampaign(campaign._id, Number(req.query.batch) || 25);
      const fresh = await Campaign.findById(campaign._id).lean();
      return res.status(200).json({ campaign: fresh, batch, queued: started.stats.queued });
    }
    if (action === "schedule") {
      if (!["draft", "scheduled"].includes(campaign.status)) return res.status(409).json({ error: `Campaign is already ${campaign.status}` });
      const at = new Date(req.body?.scheduledAt || "");
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60000) return res.status(400).json({ error: "Pick a future date and time" });
      campaign.scheduledAt = at;
      campaign.status = "scheduled";
      await campaign.save();
      return res.status(200).json({ campaign });
    }
    if (action === "unschedule") {
      if (campaign.status !== "scheduled") return res.status(409).json({ error: "Campaign is not scheduled" });
      campaign.status = "draft";
      campaign.scheduledAt = null;
      await campaign.save();
      return res.status(200).json({ campaign });
    }
    if (action === "process") {
      if (campaign.status !== "sending") return res.status(200).json({ campaign: campaign.toObject(), batch: { sent: 0, remaining: 0 } });
      const batch = await processCampaign(campaign._id, Number(req.query.batch) || 25);
      const fresh = await Campaign.findById(campaign._id).lean();
      return res.status(200).json({ campaign: fresh, batch });
    }
    if (action === "pause") {
      if (campaign.status !== "sending") return res.status(409).json({ error: "Campaign is not sending" });
      campaign.status = "paused";
      await campaign.save();
      return res.status(200).json({ campaign });
    }
    if (action === "resume") {
      if (campaign.status !== "paused") return res.status(409).json({ error: "Campaign is not paused" });
      campaign.status = "sending";
      campaign.lastError = "";
      await campaign.save();
      return res.status(200).json({ campaign });
    }
    if (action === "cancel") {
      if (!["sending", "paused"].includes(campaign.status)) return res.status(409).json({ error: "Campaign is not running" });
      const r = await CampaignMessage.updateMany({ campaignId: campaign._id, status: "queued" }, { $set: { status: "skipped", skipReason: "Campaign cancelled" } });
      campaign.status = "done";
      campaign.finishedAt = new Date();
      campaign.stats.skipped += r.modifiedCount || 0;
      await campaign.save();
      return res.status(200).json({ campaign });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("[campaigns] action failed:", err);
    return res.status(422).json({ error: err.message });
  }
}

export default requireAdminOrSuperAdmin(handler);
