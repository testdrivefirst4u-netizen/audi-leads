const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireCompanyMember } = require("../../../lib/auth");
const { nextFollowUp } = require("../../../lib/leadFields");
const { withCache } = require("../../../lib/serverCache");

// Deliberately its own tiny endpoint rather than reusing /api/leads: the
// sidebar badge polls from every page, not just Leads, so it needs to stay
// far cheaper than a full paginated leads query. Shares the same
// `followup-tabs:${companyId}` cache-key prefix as pages/api/leads.js so the
// invalidate() calls added to the remarks/calls/status/followups endpoints
// clear this cache too.
const CACHE_MS = 5000;

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();

  const filter = { companyId: req.session.companyId };
  if (req.session.role === "agent") filter.assignedTo = req.session.agentId;

  const cacheKey = `followup-tabs:${req.session.companyId}|badge|${req.session.role}|${req.session.agentId || ""}`;
  const counts = await withCache(cacheKey, CACHE_MS, async () => {
    const candidates = await Lead.find({ ...filter, "followUps.0": { $exists: true } })
      .select("followUps")
      .lean();
    let overdue = 0;
    let today = 0;
    for (const lead of candidates) {
      const info = nextFollowUp(lead);
      if (info?.status === "overdue") overdue++;
      else if (info?.status === "today") today++;
    }
    return { overdue, today };
  });

  res.status(200).json(counts);
}

export default requireCompanyMember(handler);
