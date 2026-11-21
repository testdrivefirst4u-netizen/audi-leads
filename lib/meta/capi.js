const crypto = require("crypto");
const Settings = require("../../models/Settings");
const CapiEvent = require("../../models/CapiEvent");
const Lead = require("../../models/Lead");
const LeadEvent = require("../../models/LeadEvent");
const { decryptSecret } = require("./crypto");
const { apiVersion, redact } = require("./graph");

// Meta Conversions API for Lead Ads ("CRM integration"): when a lead that
// came from a Meta lead form reaches one of the company's chosen stages
// (Settings.meta.capi.stages), that stage is sent to the company's dataset
// as an event, keyed on Meta's own lead ID. Ads Manager can then optimise for
// "conversion leads" — people likely to qualify or book — instead of raw
// form fills.
//
//   POST https://graph.facebook.com/{version}/{dataset-id}/events
//   { data: [{ event_name, event_time, action_source: "system_generated",
//              event_id, user_data: { lead_id, ph, em },
//              custom_data: { event_source: "crm", lead_event_source } }] }
//
// Each lead reaches each stage at most once (CapiEvent.eventId is unique),
// and Meta only accepts events up to 7 days old.

const SEND_TIMEOUT_MS = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const BATCH = 200; // Meta takes up to 1000 events per request
const LEAD_EVENT_SOURCE = "Broaddcast CRM";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Meta's lead ID for a lead: from the leadgen webhook, or the `id` column of
// a Meta lead export sheet ("l:1234…" or just the digits). Null for leads
// that didn't come from a Meta lead form.
function metaLeadIdOf(lead) {
  const direct = String(lead?.metaLeadId || "").trim();
  if (/^\d{10,}$/.test(direct)) return direct;
  const fromSheet = String(lead?.data?.id ?? "").trim().match(/^(?:l:)?(\d{10,})$/);
  return fromSheet ? fromSheet[1] : null;
}

// Event names allow letters, digits, spaces, "_" and "-" (up to 50):
// "Retail (Converted)" -> "Retail Converted".
function eventNameFor(stage) {
  return String(stage).replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Lead stage";
}

// Phone: full international digits (Indian 10-digit numbers get 91), hashed.
function hashedPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? sha256(d) : null;
}

function hashedEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? sha256(e) : null;
}

function buildEvent(lead, stage, eventTime) {
  const userData = { lead_id: metaLeadIdOf(lead) };
  const ph = hashedPhone(lead.phone);
  const em = hashedEmail(lead.email);
  if (ph) userData.ph = [ph];
  if (em) userData.em = [em];
  const eventName = eventNameFor(stage);
  return {
    event_name: eventName,
    event_time: Math.floor(new Date(eventTime).getTime() / 1000),
    action_source: "system_generated",
    event_id: `${lead._id}:${eventName}`,
    user_data: userData,
    custom_data: { event_source: "crm", lead_event_source: LEAD_EVENT_SOURCE },
  };
}

// lead_id is a 64-bit integer — too big for a JS number, so it's written
// into the JSON as bare digits rather than through Number().
function serialize(body) {
  return JSON.stringify(body).replace(/"lead_id":"(\d+)"/g, '"lead_id":$1');
}

// → { ok, received, fbtraceId, error }. Never throws.
async function postEvents({ datasetId, token, events, testEventCode }) {
  const body = { data: events };
  if (testEventCode) body.test_event_code = testEventCode;
  const url = `https://graph.facebook.com/${apiVersion()}/${encodeURIComponent(datasetId)}/events?access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: serialize(body), signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) {
      const e = json?.error || {};
      return { ok: false, error: redact(e.error_user_msg || e.message || `Meta returned HTTP ${res.status}`), fbtraceId: e.fbtrace_id || "" };
    }
    // Accepted events can still come back with warnings (e.g. a test code
    // that doesn't match an open Test Events session) — kept and shown.
    const note = (json?.messages || []).map((m) => redact(String(m))).join(" ").slice(0, 500);
    return { ok: true, received: json?.events_received ?? events.length, fbtraceId: json?.fbtrace_id || "", note };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? `Meta did not answer within ${SEND_TIMEOUT_MS / 1000}s` : redact(err.message) };
  } finally {
    clearTimeout(timer);
  }
}

// The company's CAPI config with its token decrypted, or null when it's off
// or incomplete.
async function activeConfig(companyId) {
  const settings = await Settings.findOne({ companyId }).select("meta.capi").lean();
  const capi = settings?.meta?.capi;
  if (!capi?.enabled || !capi.datasetId || !capi.accessTokenEnc) return null;
  let token = "";
  try {
    token = decryptSecret(capi.accessTokenEnc);
  } catch {
    return null;
  }
  return token ? { ...capi, token } : null;
}

async function noteResult(companyId, result) {
  const $set = result.ok ? { "meta.capi.lastSentAt": new Date(), "meta.capi.lastError": "" } : { "meta.capi.lastError": result.error, "meta.capi.lastErrorAt": new Date() };
  await Settings.updateOne({ companyId }, { $set }).catch(() => {});
}

// Sends one batch of { lead, stage, eventTime } for a company and records
// each in CapiEvent. Items already sent are skipped.
async function sendItems(companyId, config, items) {
  const fresh = items.filter((it) => metaLeadIdOf(it.lead) && Date.now() - new Date(it.eventTime).getTime() < MAX_AGE_MS);
  if (!fresh.length) return { sent: 0, failed: 0, skipped: items.length };
  const built = fresh.map((it) => ({ it, event: buildEvent(it.lead, it.stage, it.eventTime) }));
  const already = await CapiEvent.find({ companyId, eventId: { $in: built.map((b) => b.event.event_id) }, state: "sent" }).select("eventId").lean();
  const done = new Set(already.map((a) => a.eventId));
  const todo = built.filter((b) => !done.has(b.event.event_id));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const result = await postEvents({ datasetId: config.datasetId, token: config.token, events: chunk.map((c) => c.event), testEventCode: config.testEventCode });
    await noteResult(companyId, result);
    await CapiEvent.bulkWrite(
      chunk.map(({ it, event }) => ({
        updateOne: {
          filter: { companyId, eventId: event.event_id },
          update: {
            $set: {
              leadId: it.lead._id,
              leadName: it.lead.name || "",
              eventName: event.event_name,
              stage: it.stage,
              eventTime: new Date(it.eventTime),
              state: result.ok ? "sent" : "failed",
              lastError: result.ok ? result.note || (config.testEventCode ? "Sent as a test event only" : "") : result.error,
              fbtraceId: result.fbtraceId || "",
              ...(result.ok ? { sentAt: new Date() } : {}),
            },
            $inc: { attempts: 1 },
          },
          upsert: true,
        },
      }))
    );
    if (result.ok) sent += chunk.length;
    else failed += chunk.length;
  }
  return { sent, failed, skipped: items.length - todo.length };
}

// Called after every status change (pages/api/leads/[id]/status.js). Quietly
// does nothing for non-Meta leads, stages the company doesn't send, or when
// CAPI is off. Never throws.
async function sendStatusChange(lead, status) {
  try {
    if (!metaLeadIdOf(lead)) return null;
    const config = await activeConfig(lead.companyId);
    if (!config || !(config.stages || []).includes(status)) return null;
    return await sendItems(lead.companyId, config, [{ lead, stage: status, eventTime: new Date() }]);
  } catch (err) {
    console.error("[capi] send failed:", err.message);
    return null;
  }
}

// Re-sends failed events still young enough for Meta (cron sync, or the
// "Retry failed" button for one company).
async function retryFailed({ companyId, limit = 500 } = {}) {
  const filter = { state: "failed", attempts: { $lt: MAX_ATTEMPTS }, eventTime: { $gt: new Date(Date.now() - MAX_AGE_MS) } };
  if (companyId) filter.companyId = companyId;
  const failed = await CapiEvent.find(filter).sort({ eventTime: 1 }).limit(limit).lean();
  const byCompany = new Map();
  for (const f of failed) {
    const key = String(f.companyId);
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(f);
  }
  const totals = { sent: 0, failed: 0, skipped: 0 };
  for (const [cid, rows] of byCompany) {
    const config = await activeConfig(cid);
    if (!config) continue;
    const leads = await Lead.find({ _id: { $in: rows.map((r) => r.leadId) } }).select("name phone email metaLeadId data.id").lean();
    const byId = new Map(leads.map((l) => [String(l._id), l]));
    const items = rows.filter((r) => byId.has(String(r.leadId))).map((r) => ({ lead: byId.get(String(r.leadId)), stage: r.stage || r.eventName, eventTime: r.eventTime }));
    const r = await sendItems(cid, config, items);
    totals.sent += r.sent;
    totals.failed += r.failed;
    totals.skipped += r.skipped;
  }
  return totals;
}

// When CAPI is first switched on: sends the stage changes of the last 7 days
// (from the change log), oldest first.
async function backfill(companyId) {
  const config = await activeConfig(companyId);
  if (!config) return { error: "Turn the Conversions API on (with a dataset and token) first." };
  const since = new Date(Date.now() - MAX_AGE_MS + 60 * 60 * 1000);
  const changes = await LeadEvent.find({ companyId, type: "status", to: { $in: config.stages || [] }, createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
  const leads = await Lead.find({ _id: { $in: changes.map((c) => c.leadId) } }).select("name phone email metaLeadId data.id").lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const items = changes.filter((c) => byId.has(String(c.leadId))).map((c) => ({ lead: byId.get(String(c.leadId)), stage: c.to, eventTime: c.createdAt }));
  const r = await sendItems(companyId, config, items);
  return { changes: changes.length, ...r };
}

// One test event for the company's newest Meta lead, sent with a Test Events
// code so it shows up in Events Manager → Test events and nowhere else.
// Works before CAPI is switched on: only the dataset and token are needed.
async function sendTestEvent(companyId, testEventCode) {
  const settings = await Settings.findOne({ companyId }).select("meta.capi").lean();
  const raw = settings?.meta?.capi;
  if (!raw?.datasetId || !raw?.accessTokenEnc) return { ok: false, error: "Save the dataset ID and access token first." };
  let token = "";
  try {
    token = decryptSecret(raw.accessTokenEnc);
  } catch {
    return { ok: false, error: "The saved token can't be read any more; paste it again." };
  }
  const lead = await Lead.findOne({ companyId, $or: [{ metaLeadId: { $exists: true, $ne: null } }, { "data.id": { $regex: /^(l:)?\d{10,}$/ } }] })
    .sort({ createdAt: -1 })
    .select("name phone email metaLeadId data.id")
    .lean();
  if (!lead || !metaLeadIdOf(lead)) return { ok: false, error: "No lead from a Meta lead form in this company yet to test with." };
  const stage = (raw.stages || [])[0] || "Qualified";
  const result = await postEvents({ datasetId: raw.datasetId, token, events: [buildEvent(lead, stage, new Date())], testEventCode });
  await noteResult(companyId, result);
  return { ...result, leadName: lead.name || "", eventName: eventNameFor(stage) };
}

module.exports = { sendStatusChange, retryFailed, backfill, sendTestEvent, metaLeadIdOf, eventNameFor, buildEvent, serialize, hashedPhone, hashedEmail, MAX_AGE_MS };
