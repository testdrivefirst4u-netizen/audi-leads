const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const Company = require("../../../models/Company");
const { verifyUnsubscribeToken } = require("../../../lib/messaging/render");

// Public one-click unsubscribe link placed in every campaign email
// (and advertised via List-Unsubscribe). The token is an HMAC of
// lead id + company id, so it cannot be guessed. Marks emailOptOut on the
// lead and shows a small confirmation page. Idempotent.

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#f4f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827}.card{max-width:480px;margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px 26px}h1{font-size:20px;margin:0 0 10px}p{margin:0;color:#4b5563;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send(page("Not allowed", ""));
  const t = verifyUnsubscribeToken(req.query.t || req.body?.t);
  if (!t) return res.status(400).send(page("Link not valid", "This unsubscribe link is not valid or has been altered."));
  try {
    await connectDB();
    const lead = await Lead.findOne({ _id: t.leadId, companyId: t.companyId }).select("emailOptOut").lean();
    if (!lead) return res.status(404).send(page("Already removed", "We could not find a subscription for this address."));
    if (!lead.emailOptOut) await Lead.updateOne({ _id: t.leadId }, { $set: { emailOptOut: true, emailOptOutAt: new Date() } });
    const company = await Company.findById(t.companyId).select("name").lean();
    return res.status(200).send(page("You have been unsubscribed", `You will no longer receive marketing emails from ${company?.name || "us"}.`));
  } catch (err) {
    console.error("[unsubscribe] failed:", err.message);
    return res.status(500).send(page("Something went wrong", "Please try again in a few minutes."));
  }
}
