const nodemailer = require("nodemailer");

// Single outbound-email seam for the app. Plain SMTP via nodemailer so any
// provider works (Gmail app password, SES, SendGrid/Brevo/Resend SMTP
// relays, a company mail server) with nothing but env vars:
//   SMTP_HOST, SMTP_PORT (587 default; 465 switches to implicit TLS),
//   SMTP_USER, SMTP_PASS, SMTP_FROM ("CRM Reports <reports@example.com>").
// Deliberately not a module-level singleton created at import time — the
// transporter is built lazily so a missing config surfaces as a clear error
// from the send that needed it, not as a crash on every cold start.
let cachedTransporter = null;

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!isMailConfigured()) {
    throw new Error("Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.");
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
    // A hung SMTP server must not pin a serverless invocation open until the
    // platform kills it — fail the send, log it, and let the next run retry.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return cachedTransporter;
}

async function sendMail({ to, subject, html, text, attachments }) {
  const transporter = getTransporter();
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
    text,
    attachments,
  });
}

module.exports = { sendMail, isMailConfigured };
