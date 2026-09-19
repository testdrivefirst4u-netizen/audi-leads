const connectDB = require("../../../lib/db");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { listConversations } = require("../../../lib/messaging/chat");

// Inbox list for the Chats page. Agents see the conversations of their own
// leads; admins (and the super admin via ?companyId=) see the whole company.
//   GET ?q=&box=all|unread|unassigned
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();
  const conversations = await listConversations({ companyId: req.session.companyId, session: req.session, q: String(req.query.q || ""), box: String(req.query.box || "all") });
  return res.status(200).json({ conversations });
}

export default requireCompanyMemberOrSuperAdmin(handler);
