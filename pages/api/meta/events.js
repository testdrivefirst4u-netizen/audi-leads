const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const MetaWebhookEvent = require("../../../models/MetaWebhookEvent");
const { requireSuperAdminForCompany } = require("../../../lib/auth");
const { retryFailedEvents, processEvent } = require("../../../lib/meta/processEvent");
const { invalidate } = require("../../../lib/serverCache");

// Webhook event log for the Meta Lead Ads page:
//   GET  → the company's most recent events (its own, plus "unmapped" ones
//          for any page it has since connected)
//   POST { action: "retry", eventId }  — re-run one event
//   POST { action: "retryFailed" }     — re-run everything failed/unmapped
//          for this company's pages
const LIMIT = 50;

async function companyPageIds(companyId) {
  const settings = await Settings.findOne({ companyId }).select("meta.pages.pageId").lean();
  return (settings?.meta?.pages || []).map((p) => p.pageId);
}

function publicEvent(e) {
  return {
    _id: e._id,
    leadgenId: e.leadgenId,
    pageId: e.pageId,
    formId: e.formId || "",
    status: e.status,
    attempts: e.attempts,
    lastError: e.lastError || "",
    leadId: e.leadId || null,
    leadName: e.leadId?.name || "",
    leadPhone: e.leadId?.phone || "",
    platform: e.platform || "",
    eventTime: e.eventTime || null,
    processedAt: e.processedAt || null,
    createdAt: e.createdAt,
  };
}

async function handler(req, res) {
  if (req.session.role === "agent") return res.status(403).json({ error: "Admin access required" });
  await connectDB();
  const companyId = req.session.companyId;
  const pageIds = await companyPageIds(companyId);
  const scope = { $or: [{ companyId }, ...(pageIds.length ? [{ pageId: { $in: pageIds } }] : [])] };

  if (req.method === "GET") {
    const [events, counts] = await Promise.all([
      MetaWebhookEvent.find(scope).sort({ createdAt: -1 }).limit(LIMIT).populate("leadId", "name phone").lean(),
      MetaWebhookEvent.aggregate([{ $match: scope }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    return res.status(200).json({
      events: events.map(publicEvent),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    });
  }

  if (req.method === "POST") {
    const { action, eventId } = req.body || {};
    if (action === "retry") {
      const event = await MetaWebhookEvent.findOne({ _id: eventId, ...scope });
      if (!event) return res.status(404).json({ error: "Event not found" });
      const done = await processEvent(event);
      invalidate(`leads-meta:${companyId}`);
      return res.status(200).json({ event: publicEvent(done) });
    }
    if (action === "retryFailed") {
      const summary = await retryFailedEvents({ companyId, pageIds });
      invalidate(`leads-meta:${companyId}`);
      return res.status(200).json({ summary });
    }
    return res.status(400).json({ error: "Unknown action" });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdminForCompany(handler);
