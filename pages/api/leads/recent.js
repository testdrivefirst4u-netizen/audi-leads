const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireAuth } = require("../../../lib/auth");

// Powers the notification bell: the N most recently-created leads, newest
// first, so the client can diff against what it's already shown the user.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const filter = req.session.role === "agent" ? { assignedTo: req.session.agentId } : {};
  const leads = await Lead.find(filter)
    .select("name phone model createdAt")
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  res.status(200).json({ leads });
}

export default requireAuth(handler);
