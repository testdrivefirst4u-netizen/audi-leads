const Lead = require("../../models/Lead");
const Settings = require("../../models/Settings");
const MetaWebhookEvent = require("../../models/MetaWebhookEvent");
const { dedupeAndCreateLead } = require("../leadIngest");
const { createAgentAssigner } = require("../syncService");
const { getLead, getForm, MetaApiError, redact } = require("./graph");
const { decryptSecret } = require("./crypto");
const { mapMetaLeadToCrm } = require("./mapLead");

// The Meta Lead Ads pipeline, from a raw webhook payload to a Lead in the
// existing collection:
//
//   webhook POST → recordEvents()   — upsert one MetaWebhookEvent per leadgen
//                                     change (unique on leadgen_id, so Meta's
//                                     redeliveries collapse into one row)
//                → processEvent()   — page → company → token → Graph API →
//                                     mapMetaLeadToCrm → dedupeAndCreateLead
//                                     (the same dedup + auto-assign path the
//                                     sheet sync and public API use)
//
// Processing happens inside the webhook request, before the 200 goes back
// (a Graph lookup is well under a second; the request has an 8s cap). On a
// serverless host there is no reliable "after the response" work, so this
// is deliberately NOT fire-and-forget: if processing fails, the event is
// stored as `failed` with the reason and is retried by the Retry button on
// the Meta Lead Ads page and by retryFailedEvents() from the daily cron.
// The webhook still answers 200 in that case — Meta's own redelivery would
// only repeat the same failure, and the stored event is the durable record.

const MAX_ATTEMPTS = 8;

// Form names change rarely; one Graph call per form per process lifetime
// (Vercel invocation) is plenty and keeps the per-lead cost at one request.
const formNameCache = new Map(); // formId -> { name, at }
const FORM_CACHE_MS = 60 * 60 * 1000;

async function resolveFormName(formId, token) {
  if (!formId) return "";
  const cached = formNameCache.get(formId);
  if (cached && Date.now() - cached.at < FORM_CACHE_MS) return cached.name;
  try {
    const form = await getForm(formId, token);
    const name = form?.name || "";
    formNameCache.set(formId, { name, at: Date.now() });
    return name;
  } catch (err) {
    // A form we can't read (deleted, or token lacks the scope) shouldn't
    // block the lead itself — it just won't carry a form name.
    console.warn(`[meta] could not read form ${formId}: ${redact(err.message)}`);
    return "";
  }
}

// Which company owns this Page, and which token to read its leads with. A
// page-specific token (pasted on the Meta Lead Ads page) wins; META_ACCESS_TOKEN
// in the environment is the fallback for a single-tenant deployment or a
// system-user token that covers every page.
async function resolvePageOwner(pageId) {
  const settings = await Settings.findOne({ "meta.pages.pageId": String(pageId) }).lean();
  if (!settings) return null;
  const page = (settings.meta?.pages || []).find((p) => p.pageId === String(pageId));
  let token = "";
  if (page?.accessTokenEnc) {
    try {
      token = decryptSecret(page.accessTokenEnc);
    } catch (err) {
      throw new MetaApiError(`Stored page token could not be decrypted (${err.message}) — re-connect the page`, { code: 190, type: "OAuthException" });
    }
  }
  if (!token) token = process.env.META_ACCESS_TOKEN || "";
  return { settings, page, token };
}

async function noteOnSettings(companyId, patch) {
  try {
    await Settings.updateOne({ companyId }, { $set: patch });
  } catch (err) {
    console.error("[meta] failed to update settings status:", err.message);
  }
}

// Stores every leadgen change in the payload; returns the event docs (new
// or pre-existing) in delivery order. Anything that isn't a leadgen change
// is ignored — the app may be subscribed to other fields in future.
async function recordEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const leadgenId = value.leadgen_id ? String(value.leadgen_id) : "";
      if (!leadgenId) continue;
      const pageId = String(value.page_id || entry.id || "");
      const eventTime = value.created_time ? new Date(Number(value.created_time) * 1000) : entry.time ? new Date(Number(entry.time) * 1000) : new Date();
      const doc = await MetaWebhookEvent.findOneAndUpdate(
        { leadgenId },
        {
          $setOnInsert: {
            leadgenId,
            pageId,
            formId: value.form_id ? String(value.form_id) : "",
            adId: value.ad_id ? String(value.ad_id) : "",
            adgroupId: value.adgroup_id ? String(value.adgroup_id) : "",
            eventTime,
            payload: value,
            status: "received",
          },
        },
        { upsert: true, new: true }
      );
      events.push(doc);
    }
  }
  return events;
}

// Processes one stored event to completion (or to a retryable failure).
// Idempotent: a lead that already exists for this leadgen id — created by
// an earlier delivery, or by the Google Sheet export of the same Meta lead
// (the sheet's "id" column is this same leadgen id) — is linked, not
// duplicated.
async function processEvent(event) {
  if (event.status === "processed" || event.status === "duplicate") return event;
  if (event.attempts >= MAX_ATTEMPTS) return event;

  event.attempts += 1;

  const owner = await resolvePageOwner(event.pageId).catch((err) => ({ error: err }));
  if (!owner) {
    event.status = "unmapped";
    event.lastError = `Page ${event.pageId} is not connected to any company — add it on the Meta Lead Ads page`;
    await event.save();
    return event;
  }
  if (owner.error) {
    event.status = "failed";
    event.lastError = redact(owner.error.message);
    await event.save();
    return event;
  }

  const { settings, token } = owner;
  const companyId = settings.companyId;
  event.companyId = companyId;
  await noteOnSettings(companyId, { "meta.lastWebhookAt": new Date() });

  if (settings.meta?.enabled === false) {
    event.status = "failed";
    event.lastError = "Meta Lead Ads is disabled for this company";
    await event.save();
    return event;
  }

  try {
    // Already in the CRM? (webhook redelivery, retry after a partial
    // failure, or the sheet sync got there first.)
    const existing =
      (await Lead.findOne({ metaLeadId: event.leadgenId }).select("_id").lean()) ||
      (await Lead.findOne({ companyId, leadId: event.leadgenId }).select("_id metaLeadId").lean());
    if (existing) {
      if (!existing.metaLeadId) {
        await Lead.updateOne({ _id: existing._id }, { $set: { metaLeadId: event.leadgenId, metaPageId: event.pageId, metaFormId: event.formId || undefined } });
      }
      event.status = "processed";
      event.leadId = existing._id;
      event.lastError = "";
      event.processedAt = new Date();
      await event.save();
      return event;
    }

    const lead = await getLead(event.leadgenId, token);
    const formName = await resolveFormName(lead.form_id || event.formId, token);
    const mapped = mapMetaLeadToCrm({ lead, formName, pageId: event.pageId, settings });
    const assignNext = await createAgentAssigner(companyId);

    const { lead: saved, status } = await dedupeAndCreateLead({ companyId, ...mapped, assignNext });
    // A repeat enquiry folds into the customer's existing lead for that
    // model — that lead keeps its own identifiers, so stamp the Meta ids
    // on it only if it has none (so the next redelivery short-circuits).
    if (status === "duplicate" && !saved.metaLeadId) {
      await Lead.updateOne({ _id: saved._id, metaLeadId: { $exists: false } }, { $set: { metaLeadId: event.leadgenId, metaPageId: event.pageId } }).catch(() => {});
    }

    event.status = status === "duplicate" ? "duplicate" : "processed";
    event.leadId = saved._id;
    event.platform = mapped.platform;
    event.lastError = "";
    event.processedAt = new Date();
    await event.save();
    await noteOnSettings(companyId, { "meta.lastLeadAt": new Date(), "meta.lastError": "", "meta.lastErrorAt": null });
    return event;
  } catch (err) {
    // A unique-index clash on metaLeadId means a concurrent delivery won
    // the race — that's success, not failure.
    if (err?.code === 11000) {
      const winner = await Lead.findOne({ metaLeadId: event.leadgenId }).select("_id").lean();
      event.status = "processed";
      event.leadId = winner?._id;
      event.lastError = "";
      event.processedAt = new Date();
      await event.save();
      return event;
    }
    const message = redact(err.message);
    const hint = err instanceof MetaApiError && err.isAuthError ? " (access token expired or invalid — re-connect the page)" : "";
    event.status = "failed";
    event.lastError = `${message}${hint}`.slice(0, 500);
    await event.save();
    await noteOnSettings(companyId, { "meta.lastError": event.lastError, "meta.lastErrorAt": new Date() });
    console.error(`[meta] lead ${event.leadgenId} failed (attempt ${event.attempts}): ${event.lastError}`);
    return event;
  }
}

// Webhook entry point: record everything first (so nothing is lost even if
// processing throws), then process each event in order.
async function processWebhookPayload(payload) {
  const events = await recordEvents(payload);
  const results = [];
  for (const event of events) {
    const done = await processEvent(event);
    results.push({ leadgenId: done.leadgenId, status: done.status, error: done.lastError || undefined });
  }
  return results;
}

// Re-runs stored events that never became a lead — failed (Graph/DB
// errors) and unmapped (page connected after the lead arrived). Called by
// the Meta Lead Ads page's Retry button and once a day by /api/cron/sync.
async function retryFailedEvents({ companyId, pageIds, limit = 100 } = {}) {
  const filter = { status: { $in: ["failed", "unmapped", "received"] }, attempts: { $lt: MAX_ATTEMPTS } };
  if (companyId) {
    filter.$or = [{ companyId }, ...(pageIds?.length ? [{ pageId: { $in: pageIds } }] : [])];
  }
  const events = await MetaWebhookEvent.find(filter).sort({ createdAt: 1 }).limit(limit);
  const summary = { retried: events.length, processed: 0, duplicate: 0, failed: 0, unmapped: 0 };
  for (const event of events) {
    const done = await processEvent(event);
    summary[done.status] = (summary[done.status] || 0) + 1;
  }
  return summary;
}

module.exports = { recordEvents, processEvent, processWebhookPayload, retryFailedEvents, resolvePageOwner };
