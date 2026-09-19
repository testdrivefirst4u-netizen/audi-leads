const crypto = require("crypto");
const { pickField, FIELD_MATCHERS } = require("../leadFields");

// Variables available in every template, resolved from the lead (+ its
// assigned agent and company). Kept deliberately small and predictable so
// a dealer writing a template knows exactly what each one gives.
const VARIABLES = [
  { key: "name", label: "Customer name", example: "Ravi Kumar" },
  { key: "first_name", label: "Customer first name", example: "Ravi" },
  { key: "model", label: "Vehicle model", example: "Q5" },
  { key: "showroom", label: "Showroom / location", example: "Hyderabad" },
  { key: "agent", label: "Assigned agent name", example: "Spandana" },
  { key: "agent_phone", label: "Assigned agent phone", example: "98765 43210" },
  { key: "company", label: "Company name", example: "Audi Hyderabad" },
  { key: "phone", label: "Customer phone", example: "9876543210" },
];

function leadVariables({ lead, agent, company }) {
  const name = (lead?.name || "").trim();
  return {
    name: name || "there",
    first_name: name.split(/\s+/)[0] || "there",
    model: lead?.canonicalModel || lead?.model || "",
    showroom: lead?.location || pickField(lead?.data || {}, FIELD_MATCHERS.showroom) || "",
    agent: agent?.name || "",
    agent_phone: agent?.phone || "",
    company: company?.name || "",
    phone: lead?.phone || "",
  };
}

// {{var}} substitution; unknown variables are left blank rather than
// leaking "{{something}}" to a customer.
function renderText(text, vars) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => (vars[k.toLowerCase()] ?? "").toString());
}

function sampleVariables(company) {
  const v = Object.fromEntries(VARIABLES.map((x) => [x.key, x.example]));
  if (company?.name) v.company = company.name;
  return v;
}

// Signed unsubscribe token: lead id + company id, HMAC'd with AUTH_SECRET,
// so the public /api/messaging/unsubscribe link can't be forged or
// enumerated.
function unsubscribeToken(leadId, companyId) {
  const payload = `${leadId}.${companyId}`;
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET || "").update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  const [p, sig] = String(token || "").split(".");
  if (!p || !sig) return null;
  const payload = Buffer.from(p, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET || "").update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [leadId, companyId] = payload.split(".");
  return { leadId, companyId };
}

function unsubscribeUrl(baseUrl, leadId, companyId) {
  return `${baseUrl.replace(/\/$/, "")}/api/messaging/unsubscribe?t=${unsubscribeToken(leadId, companyId)}`;
}

// Plain-text body → simple HTML paragraphs; HTML bodies pass through.
function toHtml(body) {
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderEmail({ template, vars, company, unsubscribe }) {
  const subject = renderText(template.subject, vars);
  const bodyText = renderText(template.body, vars);
  const brand = company?.brandColor || "#3d5afe";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <div style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
      <div style="height:5px;background:${brand};"></div>
      <div style="padding:22px 24px;font-size:15px;">
        ${company?.logoUrl ? `<img src="${company.logoUrl}" alt="" style="max-height:36px;max-width:160px;display:block;margin-bottom:14px;">` : ""}
        ${toHtml(bodyText)}
      </div>
      <div style="padding:12px 24px;border-top:1px solid #eef0f4;font-size:11px;color:#6b7280;">
        ${company?.name || ""} · <a href="${unsubscribe}" style="color:#6b7280;">Unsubscribe</a>
      </div>
    </div>
  </div></body></html>`;
  const text = `${bodyText}\n\n—\n${company?.name || ""}\nUnsubscribe: ${unsubscribe}`;
  return { subject, html, text };
}

module.exports = { VARIABLES, leadVariables, renderText, sampleVariables, renderEmail, unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl };
