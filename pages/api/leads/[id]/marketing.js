const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const CampaignMessage = require("../../../../models/CampaignMessage");
const { requireCompanyMemberOrSuperAdmin } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");

// Marketing view of one lead: the campaign messages it received and the
// per-channel opt-out flags.
//   GET   → { messages, whatsappOptOut, emailOptOut }
//   PATCH → { whatsappOptOut?, emailOptOut? } — an agent can mark a customer
//           as opted out when they ask on a call.
async function handler(req, res) {
  await connectDB();
  const { id } = req.query;
  const filter = leadOwnershipFilter(req.session, id);

  if (req.method === "GET") {
    const lead = await Lead.findOne(filter).select("whatsappOptOut whatsappOptOutAt emailOptOut emailOptOutAt lastMarketingAt").lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const messages = await CampaignMessage.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(50).populate("campaignId", "name channel").lean();
    return res.status(200).json({
      whatsappOptOut: Boolean(lead.whatsappOptOut),
      whatsappOptOutAt: lead.whatsappOptOutAt || null,
      emailOptOut: Boolean(lead.emailOptOut),
      emailOptOutAt: lead.emailOptOutAt || null,
      lastMarketingAt: lead.lastMarketingAt || null,
      messages: messages.map((m) => ({ ...m, campaign: m.campaignId ? { _id: m.campaignId._id, name: m.campaignId.name } : null, campaignId: m.campaignId?._id || m.campaignId })),
    });
  }

  if (req.method === "PATCH") {
    const b = req.body || {};
    const set = {};
    if (typeof b.whatsappOptOut === "boolean") {
      set.whatsappOptOut = b.whatsappOptOut;
      set.whatsappOptOutAt = b.whatsappOptOut ? new Date() : null;
    }
    if (typeof b.emailOptOut === "boolean") {
      set.emailOptOut = b.emailOptOut;
      set.emailOptOutAt = b.emailOptOut ? new Date() : null;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: "Nothing to update" });
    const lead = await Lead.findOneAndUpdate(filter, { $set: set }, { new: true }).select("whatsappOptOut emailOptOut").lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    return res.status(200).json({ whatsappOptOut: Boolean(lead.whatsappOptOut), emailOptOut: Boolean(lead.emailOptOut) });
  }
  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdmin(handler);
