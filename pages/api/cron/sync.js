const connectDB = require("../../../lib/db");
const Company = require("../../../models/Company");
const { runSync } = require("../../../lib/syncService");

// The single trigger point for the background sync, on every host. This is
// a plain Next.js app with no custom server or in-process scheduler — call
// this endpoint from whatever scheduler you have (Vercel Cron, an external
// service like cron-job.org, a scheduled GitHub Action, Windows Task
// Scheduler/cron locally, or just a manual curl). Guarded by CRON_SECRET so
// it can't be triggered by anyone who finds the URL — set it as an env var
// and send `Authorization: Bearer <CRON_SECRET>`.
//
// Multi-tenant: each company has its own Google Sheet, so this loops over
// every active company and syncs them one at a time (sequential — sync
// volumes are low enough per company that parallelizing isn't worth the
// added complexity yet).
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Not authorized" });
    }
  }

  try {
    await connectDB();
    const companies = await Company.find({ active: true }).lean();

    const results = [];
    for (const company of companies) {
      const log = await runSync(company._id);
      results.push({
        companyId: String(company._id),
        companyName: company.name,
        status: log.status,
        totalRows: log.totalRows,
        newCount: log.newCount,
        updatedCount: log.updatedCount,
      });
    }

    res.status(200).json({ companies: results.length, results });
  } catch (err) {
    console.error("[cron] sync failed:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}

export default handler;
