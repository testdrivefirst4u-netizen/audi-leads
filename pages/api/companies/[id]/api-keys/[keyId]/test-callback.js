const connectDB = require("../../../../../../lib/db");
const ApiKey = require("../../../../../../models/ApiKey");
const { requireSuperAdmin } = require("../../../../../../lib/auth");

// Dry-run for the outbound status-callback URL — lets a super admin confirm
// a partner's endpoint is actually reachable and returns 2xx before relying
// on it, rather than finding out only when a real lead's status changes and
// silently fails (surfaced later in the key's delivery logs).
const TEST_TIMEOUT_MS = 4000;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId, keyId } = req.query;

  const apiKey = await ApiKey.findOne({ _id: keyId, companyId }).lean();
  if (!apiKey) return res.status(404).json({ error: "API key not found" });
  if (!apiKey.statusCallbackUrl) return res.status(400).json({ error: "No Status Callback URL configured for this key" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey.statusCallbackSecret) headers["X-Callback-Secret"] = apiKey.statusCallbackSecret;

    const response = await fetch(apiKey.statusCallbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        leadId: "test-lead-id",
        name: "Test Customer",
        phone: "9876543210",
        email: "",
        model: "Q5",
        status: "Contacted",
        previousStatus: "New",
        updatedAt: new Date().toISOString(),
        test: true,
      }),
      signal: controller.signal,
    });

    return res.status(200).json({
      success: response.ok,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      error: err.name === "AbortError" ? "Timed out after 4s" : err.message,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export default requireSuperAdmin(handler);
