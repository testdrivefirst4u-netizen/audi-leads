const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const LeadEvent = require("../../../../models/LeadEvent");
const { requireCompanyMemberOrSuperAdmin } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");

// A lead's change log (models/LeadEvent.js) — newest first. Same access rule
// as the lead itself: an agent only sees the log of leads assigned to them.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();
  const { id } = req.query;

  const lead = await Lead.findOne(leadOwnershipFilter(req.session, id)).select("_id").lean();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const events = await LeadEvent.find({ companyId: req.session.companyId, leadId: lead._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("type from to by role createdAt")
    .lean();
  res.status(200).json({ events });
}

export default requireCompanyMemberOrSuperAdmin(handler);
