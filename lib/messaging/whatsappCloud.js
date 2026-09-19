const { apiVersion, MetaApiError, redact } = require("../meta/graph");

// WhatsApp Business Platform (Cloud API) — the official channel. Everything
// is per company: the phone-number id + token come from that company's
// Settings.messaging.whatsapp. Marketing sends must be pre-approved
// templates (Meta rejects free text outside a 24-hour customer-service
// window), so the only send primitive here is sendTemplate(); sendText() is
// for replying inside that window (e.g. an agent answering a reply).
//
// Endpoints:
//   POST /{phone-number-id}/messages                 — send
//   GET  /{waba-id}/message_templates                — list approved templates
//   GET  /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating
//
// Webhook events (statuses + inbound messages) arrive on
// /api/webhooks/whatsapp and carry metadata.phone_number_id, which maps
// back to the company.

const TIMEOUT_MS = 10000;

async function request(path, { method = "GET", token, body, params = {} } = {}) {
  const url = new URL(`https://graph.facebook.com/${apiVersion()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new MetaApiError(err.name === "AbortError" ? "WhatsApp API timed out" : `WhatsApp API request failed: ${redact(err.message)}`, { status: 0, code: 4 });
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const e = json?.error || {};
    throw new MetaApiError(redact(e.message || `HTTP ${res.status}`), { code: e.code, subcode: e.error_subcode, type: e.type, status: res.status, fbtraceId: e.fbtrace_id });
  }
  return json;
}

// Phone → E.164 digits without "+" (Cloud API format). Indian 10-digit
// numbers get the 91 country code; anything already with a country code
// is left alone.
function toWaNumber(phone, defaultCountryCode = "91") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `${defaultCountryCode}${digits.slice(1)}`;
  return digits;
}

async function getPhoneNumber(phoneNumberId, token) {
  return request(phoneNumberId, { token, params: { fields: "display_phone_number,verified_name,quality_rating,name_status" } });
}

// Which Meta app the token belongs to — webhooks for a WABA go to the app
// subscribed to it, so this must be the CRM's own app (META_APP_ID).
async function tokenApp(token) {
  return request("app", { token, params: { fields: "id,name" } });
}

// Apps currently subscribed to the WABA (receive its webhooks).
async function subscribedApps(wabaId, token) {
  const r = await request(`${wabaId}/subscribed_apps`, { token });
  return (r.data || []).map((d) => d.whatsapp_business_api_data || d).map((a) => ({ id: a.id, name: a.name }));
}

// Subscribes the token's app to the WABA so messages / statuses arrive on
// this CRM's webhook.
async function subscribeApp(wabaId, token) {
  return request(`${wabaId}/subscribed_apps`, { method: "POST", token });
}

async function listTemplates(wabaId, token) {
  const out = [];
  let url = `${wabaId}/message_templates`;
  let params = { fields: "name,language,status,category,components", limit: 100 };
  for (let i = 0; i < 10; i++) {
    const page = await request(url, { token, params });
    out.push(...(page.data || []));
    const after = page.paging?.cursors?.after;
    if (!after || !page.paging?.next) break;
    params = { ...params, after };
  }
  return out;
}

// `bodyParams` are the already-rendered values for {{1}}..{{n}}.
async function sendTemplate({ phoneNumberId, token, to, templateName, language = "en", bodyParams = [], headerParam }) {
  const components = [];
  if (headerParam) components.push({ type: "header", parameters: [{ type: "text", text: String(headerParam) }] });
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })) });
  const res = await request(`${phoneNumberId}/messages`, {
    method: "POST",
    token,
    body: {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: language }, ...(components.length ? { components } : {}) },
    },
  });
  return res.messages?.[0]?.id || "";
}

async function sendText({ phoneNumberId, token, to, text }) {
  const res = await request(`${phoneNumberId}/messages`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", to, type: "text", text: { body: String(text).slice(0, 4096) } },
  });
  return res.messages?.[0]?.id || "";
}

// Flattens a webhook payload into status updates and inbound messages.
function parseWebhook(payload) {
  const statuses = [];
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id || "";
      const names = new Map((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const s of v.statuses || []) {
        statuses.push({
          phoneNumberId,
          messageId: s.id,
          status: s.status, // sent | delivered | read | failed
          timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
          recipient: s.recipient_id || "",
          error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message || ""}` : "",
        });
      }
      for (const m of v.messages || []) {
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
        messages.push({
          phoneNumberId,
          messageId: m.id,
          from: m.from || "",
          type: m.type || "",
          text,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          contextMessageId: m.context?.id || "",
          profileName: names.get(m.from) || "",
        });
      }
    }
  }
  return { statuses, messages };
}

// Meta template components → body with {{1}}.. placeholders kept, plus a
// per-parameter lead-variable mapping that defaults to sensible guesses
// (the admin can change the mapping on the Templates tab).
function mapMetaTemplate(t) {
  const body = t.components?.find((c) => c.type === "BODY")?.text || "";
  const header = t.components?.find((c) => c.type === "HEADER" && c.format === "TEXT")?.text || "";
  const count = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  const guesses = ["name", "model", "showroom", "agent", "agent_phone", "company", "phone"];
  return {
    waName: t.name,
    waLanguage: t.language || "en",
    waStatus: t.status || "",
    waCategory: t.category || "",
    body,
    waBodyParams: Array.from({ length: count }, (_, i) => guesses[i] || "name"),
    waHeaderParam: /\{\{1\}\}/.test(header) ? "company" : "",
    subject: header,
  };
}

const OPT_OUT_RE = /^\s*(stop|unsubscribe|opt\s*out|remove|no\s*more|cancel)\b/i;
function isOptOutText(text) {
  return OPT_OUT_RE.test(String(text || ""));
}

module.exports = { toWaNumber, getPhoneNumber, tokenApp, subscribedApps, subscribeApp, listTemplates, mapMetaTemplate, sendTemplate, sendText, parseWebhook, isOptOutText };
