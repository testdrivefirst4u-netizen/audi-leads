const { runSync } = require("../../../lib/syncService");

// The single trigger point for the background sync, on every host. This is
// a plain Next.js app with no custom server or in-process scheduler — call
// this endpoint from whatever scheduler you have (Vercel Cron, an external
// service like cron-job.org, a scheduled GitHub Action, Windows Task
// Scheduler/cron locally, or just a manual curl). Guarded by CRON_SECRET so
// it can't be triggered by anyone who finds the URL — set it as an env var
// and send `Authorization: Bearer <CRON_SECRET>`.
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
    const log = await runSync();
    res.status(200).json({ status: log.status, totalRows: log.totalRows, newCount: log.newCount, updatedCount: log.updatedCount });
  } catch (err) {
    console.error("[cron] sync failed:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}

export default handler;
