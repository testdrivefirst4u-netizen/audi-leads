// Next.js instrumentation hook — runs once when the server process starts.
//
// Earlier attempt at this imported lib/db.js (and therefore mongoose/dns)
// directly here, which broke: Next bundles instrumentation.js in a way that
// can't resolve Node core modules like 'dns' for this file specifically
// (works fine for normal API routes, just not here). Importing nothing but
// plain fetch/setInterval sidesteps that entirely — this just calls the
// already-working /api/cron/sync endpoint over HTTP, on a timer, in-process.
//
// This only makes sense where a persistent process actually exists (local
// dev, or any host running `next start` continuously — Render, Railway, a
// VPS, etc.). On Vercel there's no persistent process for setInterval to
// live in, so this skips itself there (detected via the VERCEL env var);
// automatic sync on Vercel needs Vercel Cron (vercel.json) or an external
// scheduler hitting /api/cron/sync instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return;

  const port = process.env.PORT || "3000";
  const secret = process.env.CRON_SECRET;
  const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES) || 1;

  const trigger = () => {
    fetch(`http://localhost:${port}/api/cron/sync`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    })
      .then((res) => res.json())
      .then((data) => console.log("[local-cron] sync:", data))
      .catch((err) => console.error("[local-cron] sync failed:", err.message));
  };

  console.log(`[local-cron] will sync every ${intervalMinutes} minute(s) via /api/cron/sync`);
  setTimeout(trigger, 5000); // give the server a moment to finish starting up
  setInterval(trigger, intervalMinutes * 60 * 1000);

  // Daily lead-report emails (lib/emailReports.js) — the endpoint itself
  // decides which companies are actually due, so polling it every 15
  // minutes just bounds how late after a company's send hour it goes out.
  const triggerReports = () => {
    fetch(`http://localhost:${port}/api/cron/email-reports`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        const sent = (data.results || []).filter((r) => r.status === "sent").length;
        if (sent > 0 || data.error) console.log("[local-cron] email reports:", data);
      })
      .catch((err) => console.error("[local-cron] email reports failed:", err.message));
  };
  setTimeout(triggerReports, 15000);
  setInterval(triggerReports, 15 * 60 * 1000);

  // Marketing campaigns (lib/messaging/engine.js) — starts scheduled
  // campaigns and pushes any campaign still sending forward by a batch.
  // The campaign report page drives sending too while it is open; this
  // keeps scheduled ones moving unattended.
  const triggerCampaigns = () => {
    fetch(`http://localhost:${port}/api/cron/campaigns`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.started || (data.processed || []).some((p) => p.sent || p.failed) || data.error) console.log("[local-cron] campaigns:", data);
      })
      .catch((err) => console.error("[local-cron] campaigns failed:", err.message));
  };
  setTimeout(triggerCampaigns, 25000);
  setInterval(triggerCampaigns, 60 * 1000);
}
