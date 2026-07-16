const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireCompanyMember } = require("../../../lib/auth");

// Powers the notification bell: the N most recently-active leads (either
// brand new, or bumped by a repeat enquiry — see lib/syncService.js),
// newest first, so the client can diff against what it's already shown the
// user. Uses lastEnquiryAt rather than createdAt so a repeat enquiry on an
// existing lead surfaces as a notification too, not just brand-new leads.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const filter = { companyId: req.session.companyId };
  if (req.session.role === "agent") filter.assignedTo = req.session.agentId;
  const leads = await Lead.find(filter)
    .select("name phone model createdAt lastEnquiryAt duplicateCount")
    .sort({ lastEnquiryAt: -1, createdAt: -1 })
    .limit(20)
    .lean();

  res.status(200).json({
    leads: leads.map((l) => ({
      ...l,
      activityAt: l.lastEnquiryAt || l.createdAt,
      isRepeat: (l.duplicateCount || 0) > 0,
    })),
  });
}

export default requireCompanyMember(handler);
