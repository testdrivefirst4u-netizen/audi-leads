const connectDB = require("../../../lib/db");
const { runDueCampaigns } = require("../../../lib/messaging/engine");
const { withTiming } = require("../../../lib/perfMonitor");

// Scheduled trigger for marketing campaigns — starts campaigns whose
// scheduled time has passed and sends the next batch of every campaign
// that is still sending. Same auth contract as the other crons
// (`Authorization: Bearer <CRON_SECRET>`). The Campaigns page also drives
// sending itself while it is open (POST /api/messaging/campaigns/[id]/process),
// so on Vercel Hobby (daily crons only) a campaign still finishes as long
// as someone keeps the report open; this cron just makes sure scheduled
// and half-finished campaigns move even if nobody is watching.
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "Server misconfiguration: CRON_SECRET is not set." });
  if (req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: "Not authorized" });
  try {
    await connectDB();
    const result = await runDueCampaigns({ batch: Number(req.query.batch) || 40 });
    res.status(200).json(result);
  } catch (err) {
    console.error("[cron] campaigns failed:", err);
    res.status(500).json({ error: "Server error during campaign run — see server logs for detail." });
  }
}

export default withTiming("/api/cron/campaigns", handler);
