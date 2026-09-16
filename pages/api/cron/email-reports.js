const connectDB = require("../../../lib/db");
const { runScheduledReports } = require("../../../lib/emailReports");
const { withTiming } = require("../../../lib/perfMonitor");

// Scheduled trigger for the per-company daily lead report emails — same
// contract as /api/cron/sync: hit it from Vercel Cron (vercel.json), an
// external scheduler, or the local in-process timer (instrumentation.js),
// always with `Authorization: Bearer <CRON_SECRET>`. Safe to call as often
// as you like: lib/emailReports.js's runScheduledReports() only sends each
// company's report once per calendar day (in that company's timezone) and
// only once the clock has passed its configured send hour. vercel.json
// schedules this once a day at 03:30 UTC (09:00 IST) because Vercel's Hobby
// plan rejects deployments with crons more frequent than daily — on Pro,
// switch it to hourly ("0 * * * *") so each company's own send hour is
// honoured exactly; on the daily schedule a company's report goes out at
// that 09:00 IST run provided its send hour is 9:00 AM or earlier.
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run email reports.");
    return res.status(500).json({ error: "Server misconfiguration: CRON_SECRET is not set." });
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Not authorized" });
  }

  try {
    await connectDB();
    const results = await runScheduledReports();
    res.status(200).json({ companies: results.length, results });
  } catch (err) {
    console.error("[cron] email reports failed:", err);
    res.status(500).json({ error: "Server error during email reports — see server logs for detail." });
  }
}

export default withTiming("/api/cron/email-reports", handler);
