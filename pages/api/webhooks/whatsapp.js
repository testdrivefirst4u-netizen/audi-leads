const crypto = require("crypto");
const connectDB = require("../../../lib/db");
const { parseWebhook } = require("../../../lib/messaging/whatsappCloud");
const { applyWhatsAppStatus, applyWhatsAppInbound } = require("../../../lib/messaging/engine");
const { withTiming } = require("../../../lib/perfMonitor");

// WhatsApp Business Platform webhook — https://<crm-domain>/api/webhooks/whatsapp
//
// Same contract as the Meta Lead Ads webhook (pages/api/webhooks/meta.js):
// GET handshake with META_VERIFY_TOKEN, POST signed with META_APP_SECRET.
// Subscribe the app to the "messages" field of the WhatsApp product in the
// Meta App Dashboard. Events carry metadata.phone_number_id, which maps
// back to the company that owns that number (Settings.messaging.whatsapp).
//
//   statuses  → campaign message delivered / read / failed
//   messages  → customer replies: STOP-style text opts the customer out of
//               WhatsApp marketing; any reply is recorded on the campaign
//               and as a remark on the lead so the agent sees it.

export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function signatureValid(rawBody, header, secret) {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

async function handler(req, res) {
  if (req.method === "GET") {
    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected) return res.status(500).send("Webhook not configured");
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === expected && req.query["hub.challenge"]) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(String(req.query["hub.challenge"]));
    }
    return res.status(403).send("Verification failed");
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[whatsapp-webhook] META_APP_SECRET is not set — refusing unsigned webhook traffic.");
    return res.status(500).json({ error: "Webhook not configured" });
  }
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(413).json({ error: err.message });
  }
  if (!signatureValid(rawBody, req.headers["x-hub-signature-256"], appSecret)) {
    console.warn("[whatsapp-webhook] rejected request with missing/invalid X-Hub-Signature-256");
    return res.status(401).json({ error: "Invalid signature" });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (payload?.object !== "whatsapp_business_account") return res.status(200).json({ received: true, ignored: true });

  const { statuses, messages } = parseWebhook(payload);
  try {
    await connectDB();
    let matched = 0;
    for (const s of statuses) if (await applyWhatsAppStatus(s)) matched++;
    const inbound = [];
    for (const m of messages) inbound.push(await applyWhatsAppInbound(m));
    return res.status(200).json({ received: true, statuses: statuses.length, matched, inbound: inbound.length });
  } catch (err) {
    console.error("[whatsapp-webhook] failed:", err.message);
    return res.status(500).json({ error: "Temporarily unable to accept events" });
  }
}

export default withTiming("/api/webhooks/whatsapp", handler);
