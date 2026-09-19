const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const { requireAdminOrSuperAdmin } = require("../../../lib/auth");
const { encryptSecret, decryptSecret, tokenPreview } = require("../../../lib/meta/crypto");
const { getPhoneNumber } = require("../../../lib/messaging/whatsappCloud");
const { isMailConfigured } = require("../../../lib/mailer");

// Per-company messaging (marketing) settings — each client connects its OWN
// WhatsApp Business number and its OWN sender email, so one dealer's
// customers never hear from another dealer's number.
//   GET   → current config, secrets redacted to a preview
//   PATCH → { whatsapp: {wabaId, phoneNumberId, accessToken?, clear?},
//             email: {fromName, fromEmail, replyTo, brevoApiKey?, clearKey?},
//             timezone, quietHoursStart, quietHoursEnd, weeklyCap }
//           A WhatsApp token/phone change is verified against the Cloud API
//           before it is saved; leave accessToken / brevoApiKey out (or
//           empty) to keep the stored secret.
// Company admins manage their own company; the super admin passes ?companyId=.

function publicConfig(m = {}) {
  const w = m.whatsapp || {};
  const e = m.email || {};
  return {
    whatsapp: {
      provider: w.provider || "",
      wabaId: w.wabaId || "",
      phoneNumberId: w.phoneNumberId || "",
      displayPhone: w.displayPhone || "",
      displayName: w.displayName || "",
      hasToken: Boolean(w.accessTokenEnc),
      tokenPreview: w.tokenPreview || "",
      qualityRating: w.qualityRating || "",
      verifiedAt: w.verifiedAt || null,
      lastError: w.lastError || "",
      templatesSyncedAt: w.templatesSyncedAt || null,
    },
    email: {
      provider: e.brevoApiKeyEnc || process.env.BREVO_API_KEY ? "brevo" : isMailConfigured() ? "smtp" : "",
      fromName: e.fromName || "",
      fromEmail: e.fromEmail || "",
      replyTo: e.replyTo || "",
      hasKey: Boolean(e.brevoApiKeyEnc),
      keyPreview: e.keyPreview || "",
      platformKey: Boolean(process.env.BREVO_API_KEY),
      smtpFallback: isMailConfigured(),
      verifiedAt: e.verifiedAt || null,
      lastError: e.lastError || "",
    },
    timezone: m.timezone || "Asia/Kolkata",
    quietHoursStart: Number.isInteger(m.quietHoursStart) ? m.quietHoursStart : 21,
    quietHoursEnd: Number.isInteger(m.quietHoursEnd) ? m.quietHoursEnd : 9,
    weeklyCap: Number.isInteger(m.weeklyCap) ? m.weeklyCap : 2,
  };
}

function webhookBase(req) {
  if (process.env.META_WEBHOOK_URL) return new URL(process.env.META_WEBHOOK_URL).origin;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}` : "";
}

async function handler(req, res) {
  await connectDB();
  const companyId = req.session.companyId;
  const base = webhookBase(req);
  const app = {
    whatsappWebhookUrl: `${base}/api/webhooks/whatsapp`,
    emailWebhookUrl: `${base}/api/webhooks/email?token=<BREVO_WEBHOOK_SECRET>`,
    verifyTokenSet: Boolean(process.env.META_VERIFY_TOKEN),
    appSecretSet: Boolean(process.env.META_APP_SECRET),
    brevoWebhookSecretSet: Boolean(process.env.BREVO_WEBHOOK_SECRET),
  };

  if (req.method === "GET") {
    const settings = await Settings.findOne({ companyId }).select("messaging").lean();
    return res.status(200).json({ config: publicConfig(settings?.messaging), app });
  }

  if (req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const settings = (await Settings.findOne({ companyId })) || new Settings({ companyId });
  if (!settings.messaging) settings.messaging = {};
  const m = settings.messaging;

  if (body.whatsapp) {
    const w = body.whatsapp;
    if (!m.whatsapp) m.whatsapp = {};
    if (w.clear) {
      m.whatsapp = {};
    } else {
      if (typeof w.wabaId === "string") m.whatsapp.wabaId = w.wabaId.trim();
      if (typeof w.phoneNumberId === "string") m.whatsapp.phoneNumberId = w.phoneNumberId.trim();
      if (typeof w.accessToken === "string" && w.accessToken.trim()) {
        m.whatsapp.accessTokenEnc = encryptSecret(w.accessToken.trim());
        m.whatsapp.tokenPreview = tokenPreview(w.accessToken.trim());
      }
      if (m.whatsapp.phoneNumberId && m.whatsapp.accessTokenEnc) {
        try {
          const info = await getPhoneNumber(m.whatsapp.phoneNumberId, decryptSecret(m.whatsapp.accessTokenEnc));
          m.whatsapp.provider = "cloud";
          m.whatsapp.displayPhone = info.display_phone_number || "";
          m.whatsapp.displayName = info.verified_name || "";
          m.whatsapp.qualityRating = info.quality_rating || "";
          m.whatsapp.verifiedAt = new Date();
          m.whatsapp.lastError = "";
        } catch (err) {
          m.whatsapp.lastError = err.message;
          m.whatsapp.verifiedAt = null;
          settings.markModified("messaging");
          await settings.save();
          return res.status(422).json({ error: `WhatsApp number could not be verified: ${err.message}`, config: publicConfig(settings.messaging), app });
        }
      }
    }
  }

  if (body.email) {
    const e = body.email;
    if (!m.email) m.email = {};
    if (typeof e.fromName === "string") m.email.fromName = e.fromName.trim();
    if (typeof e.fromEmail === "string") {
      const v = e.fromEmail.trim().toLowerCase();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return res.status(400).json({ error: "From email is not a valid address" });
      m.email.fromEmail = v;
    }
    if (typeof e.replyTo === "string") m.email.replyTo = e.replyTo.trim().toLowerCase();
    if (e.clearKey) {
      m.email.brevoApiKeyEnc = "";
      m.email.keyPreview = "";
    } else if (typeof e.brevoApiKey === "string" && e.brevoApiKey.trim()) {
      m.email.brevoApiKeyEnc = encryptSecret(e.brevoApiKey.trim());
      m.email.keyPreview = tokenPreview(e.brevoApiKey.trim());
    }
    m.email.provider = m.email.brevoApiKeyEnc || process.env.BREVO_API_KEY ? "brevo" : isMailConfigured() ? "smtp" : "";
    m.email.verifiedAt = m.email.fromEmail ? new Date() : null;
  }

  if (typeof body.timezone === "string" && body.timezone.trim()) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone.trim() });
      m.timezone = body.timezone.trim();
    } catch {
      return res.status(400).json({ error: "Unknown timezone" });
    }
  }
  for (const k of ["quietHoursStart", "quietHoursEnd"]) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 0 || n > 23) return res.status(400).json({ error: `${k} must be an hour 0-23` });
      m[k] = n;
    }
  }
  if (body.weeklyCap !== undefined) {
    const n = Number(body.weeklyCap);
    if (!Number.isInteger(n) || n < 0 || n > 20) return res.status(400).json({ error: "weeklyCap must be 0-20" });
    m.weeklyCap = n;
  }

  settings.markModified("messaging");
  await settings.save();
  return res.status(200).json({ ok: true, config: publicConfig(settings.messaging), app });
}

export default requireAdminOrSuperAdmin(handler);
