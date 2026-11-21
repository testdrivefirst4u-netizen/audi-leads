const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const CapiEvent = require("../../../models/CapiEvent");
const Lead = require("../../../models/Lead");
const { requireSuperAdminForCompany } = require("../../../lib/auth");
const { encryptSecret, decryptSecret, tokenPreview } = require("../../../lib/meta/crypto");
const { apiVersion, redact } = require("../../../lib/meta/graph");
const { effectiveStatuses } = require("../../../lib/leadFields");
const { sendTestEvent, retryFailed, backfill, MAX_AGE_MS } = require("../../../lib/meta/capi");

// Meta Conversions API settings for one company (components/CapiPanel.js):
//   GET   → config (token redacted), the company's statuses, counts and
//           the latest events sent
//   PATCH → dataset ID, access token (only when a new one is pasted),
//           stages, test event code, on/off. A new dataset/token pair is
//           checked with Meta before it's saved.
//   POST  { action: "test" | "retry" | "backfill" }
// Super admin only, like the rest of the Meta integration.

const META_LEAD_FILTER = { $or: [{ metaLeadId: { $exists: true, $ne: null } }, { "data.id": { $regex: /^(l:)?\d{10,}$/ } }] };

// Reads the dataset's name with the token → { ok, name } or { ok: false, error, badToken }.
// Tokens from Events Manager's "Generate access token" may only be allowed
// to send events, not read the dataset ("(#100) Missing Permission"), so only
// an invalid or expired token (code 190) is treated as bad; "Send test
// event" is the real check.
async function checkDataset(datasetId, token) {
  try {
    const res = await fetch(`https://graph.facebook.com/${apiVersion()}/${encodeURIComponent(datasetId)}?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) {
      const e = json?.error || {};
      return { ok: false, badToken: e.code === 190 || e.code === 102, error: redact(e.message || `Meta returned HTTP ${res.status}`) };
    }
    return { ok: true, name: json?.name || "" };
  } catch (err) {
    return { ok: false, error: redact(err.message) };
  }
}

function publicConfig(capi = {}) {
  return {
    enabled: Boolean(capi.enabled),
    datasetId: capi.datasetId || "",
    datasetName: capi.datasetName || "",
    hasToken: Boolean(capi.accessTokenEnc),
    tokenPreview: capi.tokenPreview || "",
    stages: capi.stages || [],
    testEventCode: capi.testEventCode || "",
    lastSentAt: capi.lastSentAt || null,
    lastError: capi.lastError || "",
    lastErrorAt: capi.lastErrorAt || null,
  };
}

async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;

  if (req.method === "GET") {
    const settings = await Settings.findOne({ companyId }).select("meta.capi statusOptions").lean();
    const weekAgo = new Date(Date.now() - MAX_AGE_MS);
    const datasetId = settings?.meta?.capi?.datasetId || "";
    const [events, sentWeek, failed, metaLeads] = await Promise.all([
      CapiEvent.find({ companyId }).sort({ updatedAt: -1 }).limit(50).lean(),
      // counts are for the dataset the company sends to now
      CapiEvent.countDocuments({ companyId, datasetId, state: "sent", sentAt: { $gte: weekAgo } }),
      CapiEvent.countDocuments({ companyId, datasetId, state: "failed", eventTime: { $gte: weekAgo } }),
      Lead.countDocuments({ companyId, ...META_LEAD_FILTER }),
    ]);
    return res.status(200).json({
      config: publicConfig(settings?.meta?.capi),
      statuses: effectiveStatuses(settings?.statusOptions),
      counts: { sentWeek, failed, metaLeads },
      events: events.map((e) => ({
        id: String(e._id),
        leadId: String(e.leadId),
        leadName: e.leadName,
        eventName: e.eventName,
        datasetId: e.datasetId || "",
        eventTime: e.eventTime,
        state: e.state,
        attempts: e.attempts,
        lastError: e.lastError,
        sentAt: e.sentAt || null,
      })),
    });
  }

  if (req.method === "PATCH") {
    const body = req.body || {};
    const settings = await Settings.findOne({ companyId }).select("meta.capi statusOptions").lean();
    const current = settings?.meta?.capi || {};
    const $set = {};
    let warning = "";

    const datasetId = body.datasetId !== undefined ? String(body.datasetId).trim() : current.datasetId || "";
    if (datasetId && !/^\d{6,25}$/.test(datasetId)) return res.status(400).json({ error: "The dataset ID is the number shown in Events Manager (digits only)." });
    const newToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    // A token belongs to one dataset, so a different dataset needs its own.
    if (datasetId && current.datasetId && datasetId !== current.datasetId && !newToken) {
      return res.status(400).json({ error: "You changed the dataset ID: paste the access token generated for that dataset too." });
    }

    // A new dataset or token is checked with Meta before it's saved.
    if (newToken || (datasetId && datasetId !== current.datasetId)) {
      let token = newToken;
      if (!token && current.accessTokenEnc) token = decryptSecret(current.accessTokenEnc);
      if (token && datasetId) {
        const check = await checkDataset(datasetId, token);
        if (check.badToken) return res.status(400).json({ error: `Meta says this access token isn't valid: ${check.error}` });
        $set["meta.capi.datasetName"] = check.ok ? check.name : "";
        if (!check.ok) warning = "Saved. Meta didn't let this token read the dataset's details, which is normal for a token made in Events Manager. Use Send test event to confirm it works.";
      }
    }
    $set["meta.capi.datasetId"] = datasetId;
    if (newToken) {
      $set["meta.capi.accessTokenEnc"] = encryptSecret(newToken);
      $set["meta.capi.tokenPreview"] = tokenPreview(newToken);
    }
    if (Array.isArray(body.stages)) {
      const valid = effectiveStatuses(settings?.statusOptions);
      $set["meta.capi.stages"] = body.stages.filter((s) => valid.includes(s));
    }
    if (body.testEventCode !== undefined) $set["meta.capi.testEventCode"] = String(body.testEventCode).trim().slice(0, 40);
    if (body.enabled !== undefined) {
      const willHaveToken = Boolean(newToken || current.accessTokenEnc);
      if (body.enabled && (!datasetId || !willHaveToken)) return res.status(400).json({ error: "Add the dataset ID and access token before turning it on." });
      $set["meta.capi.enabled"] = Boolean(body.enabled);
    }
    await Settings.updateOne({ companyId }, { $set }, { upsert: true });
    const saved = await Settings.findOne({ companyId }).select("meta.capi").lean();
    return res.status(200).json({ config: publicConfig(saved?.meta?.capi), warning });
  }

  if (req.method === "POST") {
    const { action, testEventCode } = req.body || {};
    if (action === "test") {
      const code = String(testEventCode || "").trim();
      if (!code) return res.status(400).json({ error: "Enter the test code from Events Manager → Test events first." });
      return res.status(200).json(await sendTestEvent(companyId, code));
    }
    if (action === "retry") return res.status(200).json(await retryFailed({ companyId }));
    if (action === "backfill") return res.status(200).json(await backfill(companyId));
    return res.status(400).json({ error: "Unknown action" });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdminForCompany(handler);
