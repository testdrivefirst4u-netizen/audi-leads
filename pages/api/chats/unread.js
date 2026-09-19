const connectDB = require("../../../lib/db");
const { requireCompanyMember } = require("../../../lib/auth");
const { unreadCount } = require("../../../lib/messaging/chat");

// Sidebar badge — polled from every page, so it stays a single aggregate.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();
  return res.status(200).json(await unreadCount({ companyId: req.session.companyId, session: req.session }));
}

export default requireCompanyMember(handler);
