const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { getThread, sendReply, sendTemplateToLead, reassign } = require("../../../lib/messaging/chat");

// One conversation (keyed by lead).
//   GET                 → thread (marks it read)
//   POST { text }       → free-text reply (inside the 24-hour window)
//   POST { templateId } → approved template (re-opens the window)
//   PATCH { agentId }   → reassign (admins only)
async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;
  const { leadId } = req.query;

  if (req.method === "GET") {
    const thread = await getThread({ companyId, session: req.session, leadId, markRead: req.query.peek !== "1" });
    if (!thread) return res.status(404).json({ error: "Conversation not found" });
    return res.status(200).json(thread);
  }

  // Agents may only act on their own leads.
  if (req.session.role === "agent") {
    const mine = await Lead.exists({ _id: leadId, companyId, assignedTo: req.session.agentId });
    if (!mine) return res.status(403).json({ error: "This conversation is assigned to another agent" });
  }

  try {
    if (req.method === "POST") {
      const { text, templateId } = req.body || {};
      const msg = templateId ? await sendTemplateToLead({ companyId, leadId, templateId, session: req.session }) : await sendReply({ companyId, leadId, text, session: req.session });
      // Keep the lead timeline in step with the chat.
      await Lead.updateOne({ _id: leadId, companyId }, { $push: { remarks: { text: `WhatsApp sent: ${msg.text.slice(0, 500)}`, createdAt: new Date() } } });
      return res.status(200).json({ message: msg });
    }
    if (req.method === "PATCH") {
      if (req.session.role === "agent") return res.status(403).json({ error: "Only admins can reassign conversations" });
      await reassign({ companyId, leadId, agentId: req.body?.agentId || null });
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}

export default requireCompanyMemberOrSuperAdmin(handler);
