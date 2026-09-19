const { sendMail, isMailConfigured } = require("../mailer");

// Bulk email for campaigns. Brevo (transactional API) is the primary
// provider — it gives per-message ids and delivery/open/click/unsubscribe
// webhooks, which the campaign report needs; the company can have its own
// key or fall back to BREVO_API_KEY. Without any Brevo key, sends go
// through the same SMTP the daily reports use (works, but with no
// delivery tracking beyond "sent").

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

function brevoKeyFor(companyKey) {
  return companyKey || process.env.BREVO_API_KEY || "";
}

// Returns { provider, providerMessageId }.
async function sendCampaignEmail({ apiKey, fromName, fromEmail, replyTo, to, toName, subject, html, text, tags = [], headers = {} }) {
  const key = brevoKeyFor(apiKey);
  if (key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(BREVO_URL, {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: to, name: toName || undefined }],
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject,
          htmlContent: html,
          textContent: text,
          tags,
          headers,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err.name === "AbortError" ? "Brevo API timed out" : `Brevo request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Brevo: ${json.message || json.code || `HTTP ${res.status}`}`);
    return { provider: "brevo", providerMessageId: json.messageId || "" };
  }

  if (!isMailConfigured()) throw new Error("No email provider configured (set a Brevo API key for the company, BREVO_API_KEY, or SMTP_*)");
  const info = await sendMail({ to, subject, html, text, headers: { ...headers, "Reply-To": replyTo || undefined } });
  return { provider: "smtp", providerMessageId: info?.messageId || "" };
}

// Brevo transactional webhook events → normalised list.
function parseBrevoWebhook(body) {
  const events = Array.isArray(body) ? body : [body];
  return events
    .filter((e) => e && e.event)
    .map((e) => ({
      event: String(e.event), // delivered | opened | click | unique_opened | hard_bounce | soft_bounce | spam | unsubscribed | blocked | error | invalid_email | deferred
      messageId: e["message-id"] || e.messageId || "",
      email: e.email || "",
      timestamp: e.ts_event ? new Date(Number(e.ts_event) * 1000) : e.date ? new Date(e.date) : new Date(),
      reason: e.reason || "",
      tags: e.tags || [],
    }));
}

module.exports = { sendCampaignEmail, parseBrevoWebhook, brevoKeyFor };
