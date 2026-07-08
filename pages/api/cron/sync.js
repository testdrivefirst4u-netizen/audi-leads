const { runSync } = require("../../../lib/syncService");

// Hit by Vercel Cron on the schedule defined in vercel.json (Vercel has no
// persistent process to run node-cron in, so this replaces it in production).
// Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
// invocations when CRON_SECRET is set as an env var — verified below so this
// endpoint can't be triggered by anyone who finds the URL.
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

  const log = await runSync();
  res.status(200).json({ status: log.status, totalRows: log.totalRows, newCount: log.newCount, updatedCount: log.updatedCount });
}

export default handler;
