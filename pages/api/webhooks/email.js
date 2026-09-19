const crypto = require("crypto");
const connectDB = require("../../../lib/db");
const { parseBrevoWebhook } = require("../../../lib/messaging/email");
const { applyEmailEvent } = require("../../../lib/messaging/engine");
const { withTiming } = require("../../../lib/perfMonitor");

// Brevo transactional-email webhook — https://<crm-domain>/api/webhooks/email?token=<BREVO_WEBHOOK_SECRET>
//
// Brevo doesn't sign webhook bodies, so the shared secret travels in the
// URL you register in Brevo (Transactional → Settings → Webhooks). Events:
// delivered, opened, click, hard/soft bounce, spam, unsubscribed, blocked.

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const expected = process.env.BREVO_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[email-webhook] BREVO_WEBHOOK_SECRET is not set — refusing webhook traffic.");
    return res.status(500).json({ error: "Webhook not configured" });
  }
  const given = String(req.query.token || "");
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.status(401).json({ error: "Invalid token" });
  }
  const events = parseBrevoWebhook(req.body);
  try {
    await connectDB();
    let matched = 0;
    for (const e of events) if (await applyEmailEvent(e)) matched++;
    return res.status(200).json({ received: true, events: events.length, matched });
  } catch (err) {
    console.error("[email-webhook] failed:", err.message);
    return res.status(500).json({ error: "Temporarily unable to accept events" });
  }
}

export default withTiming("/api/webhooks/email", handler);
