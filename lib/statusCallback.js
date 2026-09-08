const ApiKey = require("../models/ApiKey");
const ApiKeyLog = require("../models/ApiKeyLog");

// Bounded so a slow/dead partner endpoint can't hang the status-change
// request that triggered it — the lead's status has already been saved by
// the time this runs, so a timeout here only means the callback itself gets
// logged as failed, not that the user's action is lost.
const CALLBACK_TIMEOUT_MS = 4000;

function buildPayload(lead, status, previousStatus) {
  return {
    leadId: String(lead._id),
    name: lead.name || "",
    phone: lead.phone || "",
    email: lead.email || "",
    model: lead.canonicalModel || lead.model || "",
    status,
    previousStatus,
    updatedAt: new Date().toISOString(),
  };
}

async function logCallback({ companyId, apiKeyId, sourceName, status, errorMessage }) {
  try {
    await ApiKeyLog.create({ companyId, apiKeyId, sourceName, direction: "outbound", status, errorMessage });
  } catch (err) {
    console.error("Failed to write outbound ApiKeyLog:", err);
  }
}

// Fires (and awaits, with a short timeout) the configured status-callback
// webhook for a lead that originated from an external API-key source — see
// ApiKey.statusCallbackUrl. A no-op for sheet-synced leads (no apiKeyId) or
// a source that hasn't configured a callback URL, so this is safe to call
// unconditionally after every status change.
async function sendStatusCallback(lead, status, previousStatus) {
  if (!lead.apiKeyId) return;

  const apiKey = await ApiKey.findById(lead.apiKeyId).lean();
  if (!apiKey || !apiKey.active || !apiKey.statusCallbackUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey.statusCallbackSecret) headers["X-Callback-Secret"] = apiKey.statusCallbackSecret;

    const res = await fetch(apiKey.statusCallbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(buildPayload(lead, status, previousStatus)),
      signal: controller.signal,
    });

    if (res.ok) {
      await logCallback({ companyId: apiKey.companyId, apiKeyId: apiKey._id, sourceName: apiKey.sourceName, status: "callback_sent" });
    } else {
      await logCallback({
        companyId: apiKey.companyId,
        apiKeyId: apiKey._id,
        sourceName: apiKey.sourceName,
        status: "callback_failed",
        errorMessage: `HTTP ${res.status}`,
      });
    }
  } catch (err) {
    await logCallback({
      companyId: apiKey.companyId,
      apiKeyId: apiKey._id,
      sourceName: apiKey.sourceName,
      status: "callback_failed",
      errorMessage: err.name === "AbortError" ? "Timed out" : err.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendStatusCallback };
