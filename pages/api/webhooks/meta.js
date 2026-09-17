const crypto = require("crypto");
const connectDB = require("../../../lib/db");
const { processWebhookPayload } = require("../../../lib/meta/processEvent");
const { withTiming } = require("../../../lib/perfMonitor");

// Meta Lead Ads webhook — https://<your-crm-domain>/api/webhooks/meta
// (this is a Pages Router project, so the route file lives here rather
// than app/api/webhooks/meta/route.js; the public URL is the same).
//
//   GET  — Meta's one-time subscription handshake: echoes hub.challenge
//          back as plain text when hub.verify_token matches META_VERIFY_TOKEN.
//   POST — leadgen events. Every request is authenticated by the
//          X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with
//          META_APP_SECRET); anything that doesn't verify is rejected
//          before it touches the database. Verified events are stored and
//          processed by lib/meta/processEvent.js, and the response is 200
//          whether or not processing succeeded — a failed event is kept
//          with its error and retried from the Meta Lead Ads page / cron,
//          which is a better outcome than having Meta hammer the endpoint
//          with redeliveries that would fail the same way.
//
// The body parser is off so the signature is computed over the exact bytes
// Meta signed; the JSON is parsed by hand afterwards.

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
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected) {
      console.error("[meta-webhook] META_VERIFY_TOKEN is not set — refusing verification.");
      return res.status(500).send("Webhook not configured");
    }
    if (mode === "subscribe" && typeof token === "string" && token === expected && challenge) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(String(challenge));
    }
    return res.status(403).send("Verification failed");
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Fail CLOSED without the app secret: an unsigned webhook would let
  // anyone on the internet inject "leads" into the CRM.
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[meta-webhook] META_APP_SECRET is not set — refusing unsigned webhook traffic.");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(413).json({ error: err.message });
  }
  if (!signatureValid(rawBody, req.headers["x-hub-signature-256"], appSecret)) {
    console.warn("[meta-webhook] rejected request with missing/invalid X-Hub-Signature-256");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) {
    // Not a page/leadgen notification — acknowledge so Meta doesn't retry.
    return res.status(200).json({ received: true, ignored: true });
  }

  try {
    await connectDB();
    const results = await processWebhookPayload(payload);
    return res.status(200).json({ received: true, events: results.length, results });
  } catch (err) {
    // Storage itself failed (e.g. MongoDB unreachable). Nothing was
    // recorded, so a non-2xx is the right answer: Meta will redeliver.
    console.error("[meta-webhook] could not store events:", err.message);
    return res.status(500).json({ error: "Temporarily unable to accept events" });
  }
}

export default withTiming("/api/webhooks/meta", handler);
