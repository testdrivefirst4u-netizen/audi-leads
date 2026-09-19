const connectDB = require("../../../../lib/db");
const Campaign = require("../../../../models/Campaign");
const MessageTemplate = require("../../../../models/MessageTemplate");
const { requireAdminOrSuperAdmin } = require("../../../../lib/auth");
const { previewAudience, cleanAudience } = require("../../../../lib/messaging/audience");

// Campaigns for the session's company (super admin: ?companyId=).
//   GET   → { campaigns } newest first
//   POST  → create a draft { name, channel, templateId, audience }
//           with ?preview=1 → only return the audience count for the
//           given channel/audience (no campaign created)

async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;

  if (req.method === "GET") {
    const campaigns = await Campaign.find({ companyId }).sort({ createdAt: -1 }).limit(200).populate("templateId", "name channel").lean();
    return res.status(200).json({
      campaigns: campaigns.map((c) => ({ ...c, template: c.templateId ? { _id: c.templateId._id, name: c.templateId.name } : null, templateId: c.templateId?._id || null })),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const b = req.body || {};
  const channel = b.channel;
  if (!["whatsapp", "email"].includes(channel)) return res.status(400).json({ error: "channel must be whatsapp or email" });
  const audience = cleanAudience(b.audience);

  if (req.query.preview === "1") {
    const preview = await previewAudience(companyId, channel, audience);
    return res.status(200).json({ preview });
  }

  if (!b.name?.trim()) return res.status(400).json({ error: "Campaign name is required" });
  const template = await MessageTemplate.findOne({ _id: b.templateId, companyId, channel, archived: { $ne: true } }).lean();
  if (!template) return res.status(400).json({ error: "Pick a template for this channel" });

  const campaign = await Campaign.create({
    companyId,
    name: b.name.trim(),
    channel,
    templateId: template._id,
    audience,
    status: "draft",
    createdBy: req.session.username || "",
  });
  return res.status(201).json({ campaign });
}

export default requireAdminOrSuperAdmin(handler);
