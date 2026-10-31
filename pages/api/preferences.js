const connectDB = require("../../lib/db");
const Admin = require("../../models/Admin");
const Agent = require("../../models/Agent");
const { requireAuth } = require("../../lib/auth");
const { THEMES } = require("../../lib/theme");

// The signed-in person's own UI preferences (currently just the colour theme),
// for every role: super admins and company admins live on Admin, agents on
// Agent — req.session.sub is their own document id either way.
async function handler(req, res) {
  await connectDB();
  const Model = req.session.role === "agent" ? Agent : Admin;

  if (req.method === "GET") {
    const user = await Model.findById(req.session.sub).select("theme").lean();
    if (!user) return res.status(404).json({ error: "Account not found" });
    return res.status(200).json({ theme: user.theme || null });
  }

  if (req.method === "PATCH") {
    const { theme } = req.body || {};
    if (!THEMES.some((t) => t.key === theme)) return res.status(400).json({ error: "Unknown theme" });
    await Model.updateOne({ _id: req.session.sub }, { $set: { theme } });
    return res.status(200).json({ theme });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default requireAuth(handler);
