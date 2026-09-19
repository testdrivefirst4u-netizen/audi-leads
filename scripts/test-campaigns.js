/* eslint-disable no-console */
// Exercises the WhatsApp / email campaign feature end to end against a
// throw-away company, with the WhatsApp Cloud API and Brevo stubbed out
// (global fetch is intercepted for graph.facebook.com / api.brevo.com), so
// nothing is ever sent. HTTP-level checks (auth, webhooks) run against the
// dev server on BASE_URL. Everything created is deleted afterwards.
//
//   node scripts/test-campaigns.js
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
for (const file of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- stub the outside world -------------------------------------------------
const realFetch = global.fetch;
const outbound = { wa: [], brevo: [] };
let failNextWa = null;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("graph.facebook.com")) {
    if (/\/message_templates/.test(u)) {
      return new Response(JSON.stringify({ data: [{ name: "test_drive_offer", language: "en", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, your {{2}} test drive at {{3}} is ready. Call {{4}}." }] }, { name: "pending_one", language: "en", status: "PENDING", category: "MARKETING", components: [{ type: "BODY", text: "Hello {{1}}" }] }] }), { status: 200 });
    }
    if (/\/messages$/.test(u) && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      if (failNextWa) {
        const e = failNextWa;
        failNextWa = null;
        return new Response(JSON.stringify({ error: e }), { status: 400 });
      }
      outbound.wa.push(body);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${outbound.wa.length}` }] }), { status: 200 });
    }
    // phone number lookup
    return new Response(JSON.stringify({ display_phone_number: "+91 98765 00000", verified_name: "Test Motors", quality_rating: "GREEN" }), { status: 200 });
  }
  if (u.includes("api.brevo.com")) {
    outbound.brevo.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ messageId: `<brevo-${outbound.brevo.length}@test>` }), { status: 201 });
  }
  return realFetch(url, opts);
};

(async () => {
  const connectDB = require("../lib/db");
  const Company = require("../models/Company");
  const Settings = require("../models/Settings");
  const Agent = require("../models/Agent");
  const Lead = require("../models/Lead");
  const Campaign = require("../models/Campaign");
  const CampaignMessage = require("../models/CampaignMessage");
  const MessageTemplate = require("../models/MessageTemplate");
  const { encryptSecret } = require("../lib/meta/crypto");
  const render = require("../lib/messaging/render");
  const wa = require("../lib/messaging/whatsappCloud");
  const { audienceFilter, previewAudience, cleanAudience } = require("../lib/messaging/audience");
  const engine = require("../lib/messaging/engine");

  await connectDB();
  const company = await Company.create({ name: "__campaign-test__", slug: `campaign-test-${Date.now()}`, active: true });
  const cleanup = async () => {
    await Promise.all([
      CampaignMessage.deleteMany({ companyId: company._id }),
      Campaign.deleteMany({ companyId: company._id }),
      MessageTemplate.deleteMany({ companyId: company._id }),
      Lead.deleteMany({ companyId: company._id }),
      Agent.deleteMany({ companyId: company._id }),
      Settings.deleteMany({ companyId: company._id }),
      Company.deleteOne({ _id: company._id }),
    ]);
  };

  try {
    console.log("\nRendering & helpers");
    const agent = await Agent.create({ name: "Spandana", phone: "9000000001", username: `camp-agent-${Date.now()}`, passwordHash: "x", companyId: company._id, active: true });
    const vars = render.leadVariables({ lead: { name: "Ravi Kumar", canonicalModel: "Q5", location: "Hyderabad", phone: "9876543210" }, agent, company });
    check("lead variables resolved (first_name, model, agent, company)", vars.first_name === "Ravi" && vars.model === "Q5" && vars.agent === "Spandana" && vars.company === "__campaign-test__");
    check("renderText substitutes {{vars}} and blanks unknown ones", render.renderText("Hi {{first_name}}, {{model}} {{nope}}!", vars) === "Hi Ravi, Q5 !");
    const tok = render.unsubscribeToken("abc", "def");
    check("unsubscribe token round-trips and rejects tampering", JSON.stringify(render.verifyUnsubscribeToken(tok)) === JSON.stringify({ leadId: "abc", companyId: "def" }) && render.verifyUnsubscribeToken(tok.slice(0, -2) + "zz") === null);
    check("toWaNumber adds 91 to 10-digit Indian numbers, keeps others", wa.toWaNumber("98765 43210") === "919876543210" && wa.toWaNumber("+44 7700 900123") === "447700900123" && wa.toWaNumber("09876543210") === "919876543210");
    check("STOP / unsubscribe recognised as opt-out", wa.isOptOutText("STOP") && wa.isOptOutText(" unsubscribe me") && !wa.isOptOutText("Yes interested"));
    const em = render.renderEmail({ template: { subject: "{{first_name}} — {{model}}", body: "Hello {{name}}\n\nSee you." }, vars, company: { name: "Test", brandColor: "#123456" }, unsubscribe: "https://x/u" });
    check("renderEmail builds subject/html/text with unsubscribe link", em.subject === "Ravi — Q5" && em.html.includes("https://x/u") && em.html.includes("#123456") && em.text.includes("Hello Ravi Kumar"));
    const mapped = wa.mapMetaTemplate({ name: "x", language: "en", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "TEXT", text: "{{1}} offer" }, { type: "BODY", text: "Hi {{1}}, {{2}} at {{3}}" }] });
    check("mapMetaTemplate keeps placeholders and guesses variable mapping", mapped.body === "Hi {{1}}, {{2}} at {{3}}" && mapped.waBodyParams.length === 3 && mapped.waHeaderParam === "company" && mapped.waStatus === "APPROVED");

    console.log("\nAudience");
    const mk = (n, extra) => ({ companyId: company._id, name: n, canonicalModel: "Q5", model: "Q5", status: "New", source: "Sheet", sheetCreatedAt: new Date(), ...extra });
    await Lead.insertMany([
      mk("Ravi Kumar", { phone: "9876543210", email: "ravi@example.com", assignedTo: agent._id, location: "Hyderabad" }),
      mk("Priya", { phone: "9876543211", email: "priya@example.com" }),
      mk("Priya Dup", { phone: "9876543211", email: "" }), // same phone → one WhatsApp message
      mk("No Phone", { phone: "", email: "nophone@example.com" }),
      mk("Opted Out", { phone: "9876543213", email: "out@example.com", whatsappOptOut: true, emailOptOut: true }),
      mk("Recent", { phone: "9876543214", email: "recent@example.com", lastMarketingAt: new Date() }),
      mk("Lost One", { phone: "9876543215", email: "lost@example.com", status: "Lost", canonicalModel: "A4", model: "A4" }),
    ]);
    const a = cleanAudience({ model: "", excludeStatuses: ["Lost"], excludeMessagedDays: 7, search: "  " });
    check("cleanAudience whitelists keys and keeps exclusions", a.excludeStatuses[0] === "Lost" && a.excludeMessagedDays === 7 && !("search" in a));
    const pw = await previewAudience(company._id, "whatsapp", a);
    check("WhatsApp audience: 6 match, 3 eligible (no phone / opted out / recent excluded)", pw.matched === 6 && pw.eligible === 3, JSON.stringify({ matched: pw.matched, eligible: pw.eligible }));
    const pe = await previewAudience(company._id, "email", { excludeStatuses: ["Lost"], excludeMessagedDays: 0 });
    check("Email audience: no email + opted out excluded, recent kept when days=0", pe.matched === 6 && pe.eligible === 4, JSON.stringify({ matched: pe.matched, eligible: pe.eligible }));
    const pm = await previewAudience(company._id, "whatsapp", { model: "A4", excludeMessagedDays: 0 });
    check("model filter narrows audience", pm.matched === 1 && pm.eligible === 1);
    check("audienceFilter combines search $or with recency $or via $and", Boolean(audienceFilter(company._id, "whatsapp", { search: "ravi", excludeMessagedDays: 7 }).$and));

    console.log("\nWhatsApp campaign (stubbed Cloud API)");
    await Settings.create({
      companyId: company._id,
      messaging: {
        whatsapp: { provider: "cloud", wabaId: "WABA1", phoneNumberId: "PN1", accessTokenEnc: encryptSecret("FAKE_TOKEN"), tokenPreview: "FAKE…", verifiedAt: new Date() },
        email: { provider: "brevo", fromName: "Test Motors", fromEmail: "offers@test.example", brevoApiKeyEnc: encryptSecret("xkeysib-fake"), keyPreview: "xkey…" },
        timezone: "Asia/Kolkata",
        quietHoursStart: 3,
        quietHoursEnd: 3, // start === end → quiet hours disabled for the test
        weeklyCap: 2,
      },
    });
    const waTemplate = await MessageTemplate.create({ companyId: company._id, channel: "whatsapp", name: "Test drive offer", waName: "test_drive_offer", waLanguage: "en", waStatus: "APPROVED", body: "Hi {{1}}, your {{2}} test drive at {{3}} is ready. Call {{4}}.", waBodyParams: ["first_name", "model", "showroom", "agent_phone"] });
    const c1 = await Campaign.create({ companyId: company._id, name: "WA test", channel: "whatsapp", templateId: waTemplate._id, audience: { excludeStatuses: ["Lost"], excludeMessagedDays: 7 }, status: "draft" });
    let started = await engine.startCampaign(c1._id);
    check("startCampaign queues one message per phone (dup phone collapsed)", started.status === "sending" && started.stats.audience === 3 && started.stats.queued === 2 && started.stats.skipped === 1, JSON.stringify(started.stats));
    check("template snapshot stored on the campaign", started.templateSnapshot?.waName === "test_drive_offer");
    let r = await engine.processCampaign(c1._id, 1);
    check("processCampaign sends a batch of 1 and reports 1 remaining", r.sent === 1 && r.remaining === 1, JSON.stringify(r));
    r = await engine.processCampaign(c1._id, 50);
    check("second batch finishes the campaign", r.sent === 1 && r.remaining === 0, JSON.stringify(r));
    let c1f = await Campaign.findById(c1._id).lean();
    check("campaign marked done with sent=2", c1f.status === "done" && c1f.stats.sent === 2 && Boolean(c1f.finishedAt), JSON.stringify(c1f.stats));
    const raviMsg = outbound.wa.find((m) => m.to === "919876543210");
    const params = raviMsg?.template?.components?.[0]?.parameters?.map((p) => p.text);
    check("Cloud API payload: E.164 number, template name, rendered body params from lead+agent", raviMsg && raviMsg.template.name === "test_drive_offer" && JSON.stringify(params) === JSON.stringify(["Ravi", "Q5", "Hyderabad", "9000000001"]), JSON.stringify(params));
    const ravi = await Lead.findOne({ companyId: company._id, name: "Ravi Kumar" }).lean();
    check("lead.lastMarketingAt stamped after send", ravi.lastMarketingAt && Date.now() - new Date(ravi.lastMarketingAt).getTime() < 60000);
    const raviCm = await CampaignMessage.findOne({ campaignId: c1._id, leadId: ravi._id }).lean();
    check("CampaignMessage stores provider message id + rendered text", /^wamid\./.test(raviCm.providerMessageId) && raviCm.rendered.startsWith("Hi Ravi, your Q5"));

    console.log("\nWhatsApp webhook events");
    const ts = new Date();
    await engine.applyWhatsAppStatus({ messageId: raviCm.providerMessageId, status: "delivered", timestamp: ts });
    await engine.applyWhatsAppStatus({ messageId: raviCm.providerMessageId, status: "read", timestamp: ts });
    await engine.applyWhatsAppStatus({ messageId: raviCm.providerMessageId, status: "delivered", timestamp: ts }); // out-of-order repeat, must not regress
    let m = await CampaignMessage.findById(raviCm._id).lean();
    c1f = await Campaign.findById(c1._id).lean();
    check("delivered → read applied in order, stats delivered=1 read=1", m.status === "read" && Boolean(m.deliveredAt) && Boolean(m.readAt) && c1f.stats.delivered === 1 && c1f.stats.read === 1, JSON.stringify(c1f.stats));
    const parsed = wa.parseWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, statuses: [{ id: "x", status: "failed", timestamp: "1700000000", errors: [{ code: 131026, title: "Message undeliverable" }] }], messages: [{ id: "in1", from: "919876543210", type: "text", text: { body: "STOP" }, timestamp: "1700000001" }] } }] }] });
    check("parseWebhook flattens statuses + inbound messages with phone_number_id", parsed.statuses.length === 1 && parsed.statuses[0].error.includes("131026") && parsed.messages[0].text === "STOP" && parsed.messages[0].phoneNumberId === "PN1");
    const inb = await engine.applyWhatsAppInbound({ phoneNumberId: "PN1", from: "919876543210", text: "STOP", timestamp: new Date() });
    const raviAfter = await Lead.findOne({ _id: ravi._id }).lean();
    m = await CampaignMessage.findById(raviCm._id).lean();
    c1f = await Campaign.findById(c1._id).lean();
    check("inbound STOP maps phone → company → lead, sets whatsappOptOut, marks message replied, adds remark", inb.handled && inb.optOut && raviAfter.whatsappOptOut === true && m.status === "replied" && m.replyText === "STOP" && c1f.stats.replied === 1 && c1f.stats.optedOut === 1 && raviAfter.remarks.some((x) => /WhatsApp reply: STOP/.test(x.text)));
    check("unknown phone_number_id is ignored", (await engine.applyWhatsAppInbound({ phoneNumberId: "NOPE", from: "1", text: "hi", timestamp: new Date() })).handled === false);

    console.log("\nSend-time guards");
    // Opt Ravi back in, enqueue, then opt out again — the send loop must catch it.
    await Lead.updateOne({ _id: ravi._id }, { $set: { whatsappOptOut: false } });
    const c2 = await Campaign.create({ companyId: company._id, name: "WA again", channel: "whatsapp", templateId: waTemplate._id, audience: { excludeStatuses: ["Lost"], excludeMessagedDays: 0 }, status: "draft" });
    await engine.startCampaign(c2._id);
    await Lead.updateOne({ _id: ravi._id }, { $set: { whatsappOptOut: true } });
    r = await engine.processCampaign(c2._id, 50);
    const c2f = await Campaign.findById(c2._id).lean();
    const c2skips = await CampaignMessage.find({ campaignId: c2._id, status: "skipped" }).lean();
    check("opted-out (via STOP) customer skipped at send time even though queued", c2skips.some((x) => String(x.leadId) === String(ravi._id) && /Opted out/.test(x.skipReason)), JSON.stringify(c2skips.map((x) => x.skipReason)));
    check("others sent (Priya + Recent); campaign done", c2f.status === "done" && r.sent === 2 && r.skipped === 1, JSON.stringify(c2f.stats));
    await Lead.updateOne({ _id: ravi._id }, { $set: { whatsappOptOut: false } });
    await Settings.updateOne({ companyId: company._id }, { $set: { "messaging.weeklyCap": 2 } });
    const c3 = await Campaign.create({ companyId: company._id, name: "WA third", channel: "whatsapp", templateId: waTemplate._id, audience: { excludeStatuses: ["Lost"], excludeMessagedDays: 0 }, status: "draft" });
    await engine.startCampaign(c3._id);
    r = await engine.processCampaign(c3._id, 50);
    const capSkips = await CampaignMessage.countDocuments({ campaignId: c3._id, skipReason: /Weekly cap/ });
    check("weekly cap (2/customer/week) skips Priya (2 sends) but not Ravi / Recent (1 send)", capSkips === 1 && r.sent === 2, JSON.stringify({ capSkips, r }));
    const pendingTpl = await MessageTemplate.create({ companyId: company._id, channel: "whatsapp", name: "Pending", waName: "pending_one", waStatus: "PENDING", body: "Hello {{1}}", waBodyParams: ["name"] });
    const c4 = await Campaign.create({ companyId: company._id, name: "Pending tpl", channel: "whatsapp", templateId: pendingTpl._id, audience: {}, status: "draft" });
    let threw = "";
    try {
      await engine.startCampaign(c4._id);
    } catch (e) {
      threw = e.message;
    }
    check("unapproved WhatsApp template refused at start", /pending/i.test(threw), threw);
    await Settings.updateOne({ companyId: company._id }, { $set: { "messaging.quietHoursStart": 0, "messaging.quietHoursEnd": 23 } });
    await Lead.updateMany({ companyId: company._id }, { $set: { lastMarketingAt: null } });
    await CampaignMessage.updateMany({ companyId: company._id }, { $set: { sentAt: new Date(Date.now() - 10 * 86400000) } });
    const c5 = await Campaign.create({ companyId: company._id, name: "Quiet", channel: "whatsapp", templateId: waTemplate._id, audience: { excludeStatuses: ["Lost"] }, status: "draft" });
    await engine.startCampaign(c5._id);
    r = await engine.processCampaign(c5._id, 50);
    check("quiet hours (0-23) → nothing sent, remaining reported", r.quietHours === true && r.sent === 0 && r.remaining >= 1, JSON.stringify(r));
    await Settings.updateOne({ companyId: company._id }, { $set: { "messaging.quietHoursStart": 3, "messaging.quietHoursEnd": 3 } });
    failNextWa = { message: "Invalid OAuth access token", code: 190 };
    r = await engine.processCampaign(c5._id, 50);
    const c5f = await Campaign.findById(c5._id).lean();
    check("auth error from Meta pauses the campaign with lastError instead of failing every row", r.paused === true && c5f.status === "paused" && /OAuth/.test(c5f.lastError), JSON.stringify({ status: c5f.status, err: c5f.lastError }));
    await Campaign.updateOne({ _id: c5._id }, { $set: { status: "sending", lastError: "" } });
    r = await engine.processCampaign(c5._id, 50);
    check("resume sends the rest", r.sent >= 1 && r.remaining === 0, JSON.stringify(r));

    console.log("\nEmail campaign (stubbed Brevo)");
    await Lead.updateMany({ companyId: company._id }, { $set: { lastMarketingAt: null } });
    await CampaignMessage.updateMany({ companyId: company._id }, { $set: { sentAt: new Date(Date.now() - 10 * 86400000) } });
    const emailTpl = await MessageTemplate.create({ companyId: company._id, channel: "email", name: "Festive", subject: "{{first_name}}, {{model}} offers", body: "Hi {{name}},\n\nYour {{model}} offer from {{company}}. Contact {{agent}}." });
    const c6 = await Campaign.create({ companyId: company._id, name: "Email test", channel: "email", templateId: emailTpl._id, audience: { excludeStatuses: ["Lost"], excludeMessagedDays: 0 }, status: "draft" });
    started = await engine.startCampaign(c6._id);
    check("email campaign queues one per email address (opted-out / no-email excluded)", started.stats.queued === 4, JSON.stringify(started.stats));
    r = await engine.processCampaign(c6._id, 50);
    const c6f = await Campaign.findById(c6._id).lean();
    check("all emails sent through Brevo; campaign done", r.sent === 4 && c6f.status === "done", JSON.stringify(r));
    const raviMail = outbound.brevo.find((b) => b.to[0].email === "ravi@example.com");
    check("Brevo payload: company sender, personalised subject, unsubscribe link + List-Unsubscribe header", raviMail && raviMail.sender.email === "offers@test.example" && raviMail.subject === "Ravi, Q5 offers" && raviMail.htmlContent.includes("/api/messaging/unsubscribe?t=") && Boolean(raviMail.headers["List-Unsubscribe"]), raviMail?.subject);
    const raviEm = await CampaignMessage.findOne({ campaignId: c6._id, to: "ravi@example.com" }).lean();
    await engine.applyEmailEvent({ event: "delivered", messageId: raviEm.providerMessageId, timestamp: new Date() });
    await engine.applyEmailEvent({ event: "unique_opened", messageId: raviEm.providerMessageId, timestamp: new Date() });
    await engine.applyEmailEvent({ event: "click", messageId: raviEm.providerMessageId, timestamp: new Date() });
    await engine.applyEmailEvent({ event: "unsubscribed", messageId: raviEm.providerMessageId, timestamp: new Date() });
    m = await CampaignMessage.findById(raviEm._id).lean();
    const c6s = (await Campaign.findById(c6._id).lean()).stats;
    const raviAfterMail = await Lead.findById(ravi._id).lean();
    check("Brevo events → delivered/opened/clicked stats and unsubscribe → emailOptOut", m.status === "clicked" && c6s.delivered === 1 && c6s.opened === 1 && c6s.clicked === 1 && c6s.optedOut === 1 && raviAfterMail.emailOptOut === true, JSON.stringify(c6s));
    const priyaEm = await CampaignMessage.findOne({ campaignId: c6._id, to: "priya@example.com" }).lean();
    await engine.applyEmailEvent({ event: "hard_bounce", messageId: "", email: "priya@example.com", reason: "mailbox missing", timestamp: new Date() });
    m = await CampaignMessage.findById(priyaEm._id).lean();
    check("bounce matched by email address when message-id missing", m.status === "bounced" && /mailbox/.test(m.error));

    console.log("\nSend test");
    const tw = await engine.sendTestMessage({ companyId: company._id, template: waTemplate.toObject(), to: "98765 00000" });
    const lastWa = outbound.wa[outbound.wa.length - 1];
    check("WhatsApp test send: 91 added, sample params, nothing recorded on leads", tw.to === "919876500000" && lastWa.to === "919876500000" && lastWa.template.components[0].parameters[0].text === "Ravi" && (await CampaignMessage.countDocuments({ companyId: company._id, to: "919876500000" })) === 0, JSON.stringify(tw));
    const te = await engine.sendTestMessage({ companyId: company._id, template: emailTpl.toObject(), to: "Me@Example.com" });
    check("email test send: [TEST] subject, lower-cased address", te.to === "me@example.com" && outbound.brevo[outbound.brevo.length - 1].subject.startsWith("[TEST] Ravi, Q5"), JSON.stringify(te));
    let bad = "";
    try {
      await engine.sendTestMessage({ companyId: company._id, template: waTemplate.toObject(), to: "12" });
    } catch (e) {
      bad = e.message;
    }
    check("invalid test number rejected", /country code/.test(bad), bad);

    console.log("\nScheduler");
    const c7 = await Campaign.create({ companyId: company._id, name: "Scheduled", channel: "email", templateId: emailTpl._id, audience: { model: "A4", excludeMessagedDays: 0 }, status: "scheduled", scheduledAt: new Date(Date.now() - 1000) });
    const c8 = await Campaign.create({ companyId: company._id, name: "Future", channel: "email", templateId: emailTpl._id, audience: {}, status: "scheduled", scheduledAt: new Date(Date.now() + 3600000) });
    const due = await engine.runDueCampaigns({ batch: 50 });
    const c7f = await Campaign.findById(c7._id).lean();
    const c8f = await Campaign.findById(c8._id).lean();
    check("runDueCampaigns starts only campaigns whose time has passed", due.started === 1 && c7f.status === "done" && c7f.stats.sent === 1 && c8f.status === "scheduled", JSON.stringify({ started: due.started, c7: c7f.status, c8: c8f.status }));

    console.log("\nHTTP (dev server)");
    let up = true;
    try {
      await realFetch(`${BASE_URL}/login`);
    } catch {
      up = false;
    }
    if (!up) {
      console.log("  (dev server not reachable on " + BASE_URL + " — skipping HTTP checks)");
    } else {
      let res = await realFetch(`${BASE_URL}/api/messaging/settings`);
      check("settings without session → 401", res.status === 401);
      res = await realFetch(`${BASE_URL}/api/messaging/campaigns`);
      check("campaigns without session → 401", res.status === 401);
      res = await realFetch(`${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.META_VERIFY_TOKEN || "")}&hub.challenge=12345`);
      check("WhatsApp webhook GET handshake echoes challenge", res.status === 200 && (await res.text()) === "12345");
      res = await realFetch(`${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
      check("wrong verify token → 403", res.status === 403);
      const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      res = await realFetch(`${BASE_URL}/api/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=deadbeef" }, body });
      check("bad signature → 401", res.status === 401);
      const sig = "sha256=" + crypto.createHmac("sha256", process.env.META_APP_SECRET || "").update(body).digest("hex");
      res = await realFetch(`${BASE_URL}/api/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body });
      check("valid signature → 200", res.status === 200, String(res.status));
      res = await realFetch(`${BASE_URL}/api/webhooks/email?token=wrong`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" });
      check("email webhook with wrong token → 401 (or 500 when BREVO_WEBHOOK_SECRET unset)", res.status === 401 || res.status === 500, String(res.status));
      const t = render.unsubscribeToken(String(ravi._id), String(company._id));
      await Lead.updateOne({ _id: ravi._id }, { $set: { emailOptOut: false } });
      res = await realFetch(`${BASE_URL}/api/messaging/unsubscribe?t=${t}`);
      const html = await res.text();
      const raviU = await Lead.findById(ravi._id).lean();
      check("public unsubscribe link opts the lead out and renders confirmation", res.status === 200 && /unsubscribed/i.test(html) && raviU.emailOptOut === true);
      res = await realFetch(`${BASE_URL}/api/messaging/unsubscribe?t=garbage`);
      check("tampered unsubscribe token → 400", res.status === 400);

      const au = process.env.SUPER_ADMIN_USERNAME;
      const ap = process.env.SUPER_ADMIN_PASSWORD;
      if (au && ap) {
        const login = await realFetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: au, password: ap }) });
        const session = /audi_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")?.[1];
        const h = { cookie: `audi_session=${session}`, "Content-Type": "application/json" };
        res = await realFetch(`${BASE_URL}/api/messaging/settings?companyId=${company._id}`, { headers: h });
        const j = await res.json();
        check("super admin reads company messaging settings with secrets redacted", res.status === 200 && j.config.whatsapp.hasToken === true && !JSON.stringify(j).includes("FAKE_TOKEN") && j.config.email.hasKey === true, JSON.stringify(j.config?.whatsapp?.tokenPreview));
        res = await realFetch(`${BASE_URL}/api/messaging/settings?companyId=${company._id}`, { method: "PATCH", headers: h, body: JSON.stringify({ quietHoursStart: 25 }) });
        check("invalid quiet hour rejected (400)", res.status === 400);
        res = await realFetch(`${BASE_URL}/api/messaging/options?companyId=${company._id}`, { headers: h });
        const opts = await res.json();
        check("options endpoint lists models/agents/counts for the audience builder", res.status === 200 && opts.models.includes("Q5") && opts.agents.length === 1 && opts.counts.withPhone >= 5, JSON.stringify(opts.counts));
        res = await realFetch(`${BASE_URL}/api/messaging/campaigns?companyId=${company._id}&preview=1`, { method: "POST", headers: h, body: JSON.stringify({ channel: "email", audience: { model: "A4", excludeMessagedDays: 0 } }) });
        const pv = await res.json();
        check("campaign preview returns eligible count", res.status === 200 && pv.preview.matched === 1, JSON.stringify(pv.preview));
        res = await realFetch(`${BASE_URL}/api/messaging/campaigns?companyId=${company._id}`, { headers: h });
        const list = await res.json();
        check("campaign list scoped to the company", res.status === 200 && list.campaigns.length === 8 && list.campaigns.every((c) => String(c.companyId) === String(company._id)), String(list.campaigns?.length));
        res = await realFetch(`${BASE_URL}/api/messaging/campaigns/${c1._id}?companyId=${company._id}`, { headers: h });
        const det = await res.json();
        check("campaign report returns messages with lead info + byStatus", res.status === 200 && det.messages.length === 2 && det.byStatus.replied === 1 && det.messages[0].lead?.name, JSON.stringify(det.byStatus));
        res = await realFetch(`${BASE_URL}/api/messaging/campaigns/${c1._id}?companyId=${company._id}`, { method: "DELETE", headers: h });
        check("a sent campaign cannot be deleted (409)", res.status === 409);
        res = await realFetch(`${BASE_URL}/api/messaging/templates?companyId=${company._id}&action=sync`, { method: "POST", headers: h });
        const sync = await res.json();
        // The dev server talks to the real Graph API (the fetch stub only covers this process), so a fake token yields 422 from Meta — proves the plumbing (settings → decrypt → Graph call → error surfaced).
        check("template sync reaches Meta with the stored token and surfaces its error (422)", res.status === 422 && /Meta/.test(sync.error), JSON.stringify(sync));
        res = await realFetch(`${BASE_URL}/api/leads/${ravi._id}/marketing?companyId=${company._id}`, { headers: h });
        const mk2 = await res.json();
        check("lead marketing endpoint lists campaign messages + opt-out flags", res.status === 200 && mk2.emailOptOut === true && mk2.messages.length >= 3, JSON.stringify({ n: mk2.messages?.length, e: mk2.emailOptOut }));
        res = await realFetch(`${BASE_URL}/api/leads/${ravi._id}/marketing?companyId=${company._id}`, { method: "PATCH", headers: h, body: JSON.stringify({ emailOptOut: false }) });
        check("opt-out can be cleared by staff", res.status === 200 && (await Lead.findById(ravi._id).lean()).emailOptOut === false);
        // Agent must be refused from campaign management.
        const { hashPassword } = require("../lib/auth");
        await Agent.updateOne({ _id: agent._id }, { $set: { passwordHash: await hashPassword("Agent#Pass123") } });
        const al = await realFetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: agent.username, password: "Agent#Pass123" }) });
        const as = /audi_session=([^;]+)/.exec(al.headers.get("set-cookie") || "")?.[1];
        if (as) {
          res = await realFetch(`${BASE_URL}/api/messaging/campaigns`, { headers: { cookie: `audi_session=${as}` } });
          check("agent cannot manage campaigns (403)", res.status === 403, String(res.status));
        } else {
          console.log("  (agent login not available — skipped agent 403 check)");
        }
      } else {
        console.log("  (SUPER_ADMIN_USERNAME/PASSWORD not set — skipped authenticated HTTP checks)");
      }
    }
  } catch (err) {
    failed++;
    console.error("  ✗ test crashed:", err);
  } finally {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
