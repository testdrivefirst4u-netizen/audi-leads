const connectDB = require("../../../lib/db");
const MessageTemplate = require("../../../models/MessageTemplate");
const Settings = require("../../../models/Settings");
const Company = require("../../../models/Company");
const { requireAdminOrSuperAdmin } = require("../../../lib/auth");
const { decryptSecret } = require("../../../lib/meta/crypto");
const { listTemplates, mapMetaTemplate } = require("../../../lib/messaging/whatsappCloud");
const { VARIABLES, renderText, sampleVariables } = require("../../../lib/messaging/render");
const { sendTestMessage } = require("../../../lib/messaging/engine");

// Message templates for campaigns.
//   GET                  → { templates, variables }
//   POST                 → create (email: subject+body; whatsapp: normally
//                          pulled in by "sync" below, but a template can
//                          also be entered by hand)
//   POST ?action=sync    → pull the approved WhatsApp templates of the
//                          company's WABA from Meta into MessageTemplate rows
//   POST ?action=test&id= → { to } send this template to one number/email
//                          with sample values (nothing recorded on a lead)
//   PATCH ?id=           → update
//   DELETE ?id=          → archive

function toPublic(t, company) {
  const vars = sampleVariables(company);
  return { ...t, preview: renderText(t.body, vars), subjectPreview: t.subject ? renderText(t.subject, vars) : "" };
}

async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;
  const company = await Company.findById(companyId).select("name").lean();

  if (req.method === "GET") {
    const channel = req.query.channel;
    const filter = { companyId, archived: { $ne: true }, ...(channel ? { channel } : {}) };
    const templates = await MessageTemplate.find(filter).sort({ updatedAt: -1 }).lean();
    return res.status(200).json({ templates: templates.map((t) => toPublic(t, company)), variables: VARIABLES });
  }

  if (req.method === "POST" && req.query.action === "sync") {
    const settings = await Settings.findOne({ companyId }).select("messaging").lean();
    const w = settings?.messaging?.whatsapp || {};
    if (!w.wabaId || !w.accessTokenEnc) return res.status(422).json({ error: "Add the WhatsApp Business Account ID and access token under Messaging settings first" });
    let remote;
    try {
      remote = await listTemplates(w.wabaId, decryptSecret(w.accessTokenEnc));
    } catch (err) {
      return res.status(422).json({ error: `Could not read templates from Meta: ${err.message}` });
    }
    let created = 0;
    let updated = 0;
    for (const t of remote) {
      const mapped = mapMetaTemplate(t);
      const existing = await MessageTemplate.findOne({ companyId, channel: "whatsapp", waName: t.name, waLanguage: mapped.waLanguage });
      if (existing) {
        existing.waStatus = mapped.waStatus;
        existing.waCategory = mapped.waCategory;
        existing.body = mapped.body;
        if (existing.waBodyParams.length !== mapped.waBodyParams.length) existing.waBodyParams = mapped.waBodyParams;
        existing.archived = false;
        await existing.save();
        updated++;
      } else {
        await MessageTemplate.create({ companyId, channel: "whatsapp", name: t.name.replace(/_/g, " "), createdBy: req.session.username || "", ...mapped });
        created++;
      }
    }
    await Settings.updateOne({ companyId }, { $set: { "messaging.whatsapp.templatesSyncedAt": new Date() } });
    return res.status(200).json({ ok: true, total: remote.length, created, updated });
  }

  if (req.method === "POST") {
    const b = req.body || {};
    if (!["whatsapp", "email"].includes(b.channel)) return res.status(400).json({ error: "channel must be whatsapp or email" });
    if (!b.name?.trim()) return res.status(400).json({ error: "Template name is required" });
    if (!b.body?.trim()) return res.status(400).json({ error: "Message body is required" });
    if (b.channel === "email" && !b.subject?.trim()) return res.status(400).json({ error: "Email subject is required" });
    if (b.channel === "whatsapp" && !b.waName?.trim()) return res.status(400).json({ error: "The approved Meta template name is required for WhatsApp" });
    const doc = await MessageTemplate.create({
      companyId,
      channel: b.channel,
      name: b.name.trim(),
      subject: (b.subject || "").trim(),
      body: b.body,
      waName: (b.waName || "").trim(),
      waLanguage: (b.waLanguage || "en").trim(),
      waStatus: b.channel === "whatsapp" ? b.waStatus || "" : "",
      waCategory: b.waCategory || "",
      waBodyParams: Array.isArray(b.waBodyParams) ? b.waBodyParams.map(String) : [],
      waHeaderParam: b.waHeaderParam || "",
      createdBy: req.session.username || "",
    });
    return res.status(201).json({ template: toPublic(doc.toObject(), company) });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id is required" });
  const t = await MessageTemplate.findOne({ _id: id, companyId });
  if (!t) return res.status(404).json({ error: "Template not found" });

  if (req.method === "POST" && req.query.action === "test") {
    const to = String(req.body?.to || "").trim();
    if (!to) return res.status(400).json({ error: "Enter the number or email to send the test to" });
    if (t.channel === "whatsapp" && t.waStatus && t.waStatus !== "APPROVED") return res.status(422).json({ error: `Template is ${t.waStatus.toLowerCase()} — only approved templates can be sent` });
    try {
      const r = await sendTestMessage({ companyId, template: t.toObject(), to });
      return res.status(200).json({ ok: true, ...r });
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    const b = req.body || {};
    for (const k of ["name", "subject", "body", "waName", "waLanguage", "waHeaderParam"]) if (typeof b[k] === "string") t[k] = b[k];
    if (Array.isArray(b.waBodyParams)) t.waBodyParams = b.waBodyParams.map(String);
    if (!t.name?.trim() || !t.body?.trim()) return res.status(400).json({ error: "Name and body are required" });
    await t.save();
    return res.status(200).json({ template: toPublic(t.toObject(), company) });
  }
  if (req.method === "DELETE") {
    t.archived = true;
    await t.save();
    return res.status(200).json({ ok: true });
  }
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

export default requireAdminOrSuperAdmin(handler);
