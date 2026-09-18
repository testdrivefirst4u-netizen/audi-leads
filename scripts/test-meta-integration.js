/* eslint-disable no-console */
// End-to-end checks for the Meta Lead Ads integration, using mock data only.
//
//   node scripts/test-meta-integration.js
//
// Two halves:
//   1. HTTP — hits the running dev server (BASE_URL, default
//      http://localhost:3000): webhook GET verification (right / wrong
//      token), POST signature enforcement, a valid signed leadgen POST, and
//      that the admin settings routes refuse unauthenticated calls. Needs
//      META_VERIFY_TOKEN + META_APP_SECRET set for the server (same values
//      as in this process's environment / .env).
//   2. Pipeline — connects to MongoDB directly, creates a throw-away test
//      company ("__meta-integration-test__"), stubs global.fetch so every
//      graph.facebook.com call returns mock responses, and drives
//      lib/meta/processEvent.js through: Facebook lead, Instagram lead,
//      duplicate webhook delivery, repeat enquiry, missing phone, missing
//      email, custom questions, Graph API failure + retry, expired token,
//      and a plain non-Meta lead through the same dedupe path. Everything it
//      creates is deleted at the end, even on failure.
//
// No real customer data, no real Meta calls.

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

// Load env files with Next.js precedence (.env.local overrides .env);
// no dotenv dependency here.
for (const file of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TEST_PAGE_ID = "990000000000001";
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sign(body, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function leadgenPayload(leadgenId, pageId = TEST_PAGE_ID) {
  return {
    object: "page",
    entry: [
      {
        id: pageId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: "leadgen",
            value: {
              ad_id: "120000000000001",
              form_id: "880000000000001",
              leadgen_id: leadgenId,
              created_time: Math.floor(Date.now() / 1000),
              page_id: pageId,
              adgroup_id: "120000000000001",
            },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- HTTP half
async function httpTests() {
  console.log("\nHTTP (dev server at " + BASE_URL + ")");
  const verify = process.env.META_VERIFY_TOKEN;
  const secret = process.env.META_APP_SECRET;
  if (!verify || !secret) {
    console.log("  (skipped — META_VERIFY_TOKEN / META_APP_SECRET not set in this environment)");
    return;
  }
  let reachable = true;
  try {
    await fetch(BASE_URL + "/login");
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.log("  (skipped — dev server not reachable)");
    return;
  }

  const q = (t) => `${BASE_URL}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(t)}&hub.challenge=challenge-123`;
  let r = await fetch(q(verify));
  check("GET verification with the right token returns the challenge", r.status === 200 && (await r.text()) === "challenge-123");
  r = await fetch(q("wrong-token"));
  check("GET verification with a wrong token is 403", r.status === 403);

  const body = JSON.stringify(leadgenPayload("770000000000001"));
  r = await fetch(`${BASE_URL}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  check("POST without a signature is rejected (401)", r.status === 401);
  r = await fetch(`${BASE_URL}/api/webhooks/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(body, "not-the-secret") },
    body,
  });
  check("POST with a bad signature is rejected (401)", r.status === 401);

  r = await fetch(`${BASE_URL}/api/webhooks/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(body, secret) },
    body,
  });
  const j = await r.json().catch(() => ({}));
  check("POST with a valid signature is accepted (200) and the event is stored", r.status === 200 && j.events === 1, JSON.stringify(j.results?.[0]));
  check("…and an unknown Page is recorded as 'unmapped', not dropped", j.results?.[0]?.status === "unmapped");

  r = await fetch(`${BASE_URL}/api/webhooks/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(body, secret) },
    body,
  });
  const j2 = await r.json().catch(() => ({}));
  check("Redelivering the same webhook does not create a second event", r.status === 200 && j2.results?.[0]?.leadgenId === "770000000000001");

  r = await fetch(`${BASE_URL}/api/meta/settings`);
  check("GET /api/meta/settings without a session is 401", r.status === 401);
  r = await fetch(`${BASE_URL}/api/meta/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("POST /api/meta/connect without a session is 401", r.status === 401);
  r = await fetch(`${BASE_URL}/api/meta/events`);
  check("GET /api/meta/events without a session is 401", r.status === 401);
  r = await fetch(`${BASE_URL}/api/auth/meta`, { redirect: "manual" });
  check("GET /api/auth/meta (Connect Facebook) without a session is 401", r.status === 401);

  // Facebook Login for Business flow, as the super admin (SUPER_ADMIN_USERNAME
  // / SUPER_ADMIN_PASSWORD from .env) acting on the first company. Facebook
  // itself is never contacted: we stop at the redirect and drive the callback
  // with error / bad-state inputs. A company admin must be refused.
  const au = process.env.SUPER_ADMIN_USERNAME;
  const ap = process.env.SUPER_ADMIN_PASSWORD;
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const l = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }) });
    const adminSession = /audi_session=([^;]+)/.exec(l.headers.get("set-cookie") || "")?.[1];
    if (adminSession) {
      r = await fetch(`${BASE_URL}/api/auth/meta`, { headers: { cookie: `audi_session=${adminSession}` }, redirect: "manual" });
      check("a company admin cannot start Connect Facebook (super admin only)", r.status === 403);
      r = await fetch(`${BASE_URL}/api/meta/settings`, { headers: { cookie: `audi_session=${adminSession}` } });
      check("a company admin cannot read Meta settings (super admin only)", r.status === 403);
    }
  }
  if (au && ap && process.env.META_APP_ID && process.env.META_APP_SECRET) {
    const login = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: au, password: ap }) });
    const session = /audi_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")?.[1];
    const companies = session ? await (await fetch(`${BASE_URL}/api/companies`, { headers: { cookie: `audi_session=${session}` } })).json().catch(() => ({})) : {};
    const companyId = companies.companies?.[0]?._id;
    if (session && companyId) {
      const cookie = `audi_session=${session}`;
      const cq = `?companyId=${companyId}`;
      r = await fetch(`${BASE_URL}/api/auth/meta${cq}`, { headers: { cookie }, redirect: "manual" });
      const loc = r.headers.get("location") || "";
      const stateCookie = /meta_oauth_state=([^;]+)/.exec(r.headers.get("set-cookie") || "")?.[1] || "";
      const state = new URL(loc, "http://x").searchParams.get("state") || "";
      check("Connect Facebook redirects to facebook.com/dialog/oauth with the app id and only the lead-ads scopes",
        r.status === 302 && loc.startsWith("https://www.facebook.com/") && loc.includes(`client_id=${process.env.META_APP_ID}`) && /scope=pages_show_list%2Cpages_manage_metadata%2Cleads_retrieval%2Cpages_read_engagement/.test(loc) && !loc.includes(process.env.META_APP_SECRET));
      check("…and sets a signed state cookie matching the state in the URL", Boolean(stateCookie) && stateCookie === state);
      r = await fetch(`${BASE_URL}/api/auth/meta/callback?state=${state}x&code=abc`, { headers: { cookie: `${cookie}; meta_oauth_state=${stateCookie}` }, redirect: "manual" });
      check("callback with a tampered state is refused (no code exchange)", r.status === 302 && /fb=error/.test(r.headers.get("location") || ""));
      r = await fetch(`${BASE_URL}/api/auth/meta/callback?state=${state}&code=abc`, { headers: { cookie }, redirect: "manual" });
      check("callback without the state cookie is refused (CSRF)", r.status === 302 && /fb=error/.test(r.headers.get("location") || ""));
      r = await fetch(`${BASE_URL}/api/auth/meta/callback?state=${state}&error=access_denied&error_reason=user_denied`, { headers: { cookie: `${cookie}; meta_oauth_state=${stateCookie}` }, redirect: "manual" });
      check("callback when the user cancels returns to the page with a reason", r.status === 302 && (r.headers.get("location") || "").includes("fb=error&reason=Facebook+login+was+cancelled"));
      r = await fetch(`${BASE_URL}/api/meta/connect-page${cq}`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ pageId: "990000000000001" }) });
      check("connect-page without a fresh Facebook login is refused (409)", r.status === 409);
      r = await fetch(`${BASE_URL}/api/meta/pages${cq}`, { headers: { cookie } });
      const pj = await r.json().catch(() => ({}));
      check("GET /api/meta/pages never includes tokens", r.status === 200 && !JSON.stringify(pj).includes("accessToken") && !JSON.stringify(pj).includes("EAA"));
    } else {
      console.log("  (Facebook Login checks skipped - super admin login failed or no company)");
    }
  } else {
    console.log("  (Facebook Login checks skipped - SUPER_ADMIN_USERNAME/PASSWORD or META_APP_ID/SECRET not set)");
  }
}

// ------------------------------------------------------------ pipeline half
function mockLead(overrides = {}) {
  return {
    id: "770000000000002",
    created_time: "2026-09-17T09:15:00+0000",
    platform: "fb",
    is_organic: false,
    form_id: "880000000000001",
    ad_id: "120000000000001",
    ad_name: "Q5 Test Drive – Video",
    adset_id: "120000000000002",
    adset_name: "Hyderabad 30-55",
    campaign_id: "120000000000003",
    campaign_name: "Q5 Sept Leads",
    field_data: [
      { name: "full_name", values: ["Test Customer"] },
      { name: "phone_number", values: ["+919000000001"] },
      { name: "email", values: ["test.customer@example.com"] },
      { name: "city", values: ["Hyderabad"] },
      { name: "which_model_are_you_interested_in?", values: ["Q5"] },
      { name: "preferred_test_drive_date", values: ["Next week"] },
    ],
    ...overrides,
  };
}

async function pipelineTests() {
  console.log("\nPipeline (direct, stubbed Graph API, throw-away company)");
  const connectDB = require("../lib/db");
  const mongoose = require("mongoose");
  const Company = require("../models/Company");
  const Settings = require("../models/Settings");
  const Lead = require("../models/Lead");
  const Agent = require("../models/Agent");
  const MetaWebhookEvent = require("../models/MetaWebhookEvent");
  const { encryptSecret } = require("../lib/meta/crypto");
  const { mapMetaLeadToCrm } = require("../lib/meta/mapLead");
  const { processWebhookPayload, retryFailedEvents } = require("../lib/meta/processEvent");
  const { dedupeAndCreateLead } = require("../lib/leadIngest");
  const { createAgentAssigner } = require("../lib/syncService");

  await connectDB();

  // OAuth state: signed, bound to a company, expiring, tamper-evident.
  const { createState, verifyState } = require("../lib/meta/oauth");
  const st = createState({ companyId: "abc", returnTo: "/meta-integration" });
  check("OAuth state round-trips with its company and rejects tampering", verifyState(st)?.companyId === "abc" && verifyState(st.slice(0, -3) + "xyz") === null && verifyState("garbage") === null);

  // Pure mapping checks first — no DB involved.
  const m = mapMetaLeadToCrm({ lead: mockLead(), formName: "Q5 Test Drive Form", pageId: TEST_PAGE_ID, settings: {} });
  check("maps name / phone (digits only) / email", m.name === "Test Customer" && m.phone === "919000000001" && m.email === "test.customer@example.com");
  check("uses the model question over the form name", m.canonicalModel === "Q5" && m.model === "Q5");
  check("keeps custom questions in data", m.data["preferred_test_drive_date"] === "Next week");
  check("Facebook platform → source 'Facebook', channel 'Paid Social'", m.platform === "facebook" && m.source === "Facebook" && m.channel === "Paid Social");
  check("normalises city to a showroom location", m.location === "Hyderabad");
  const ig = mapMetaLeadToCrm({ lead: mockLead({ platform: "ig" }), formName: "", pageId: TEST_PAGE_ID, settings: {} });
  check("Instagram platform → source 'Instagram'", ig.platform === "instagram" && ig.source === "Instagram");
  const noModel = mapMetaLeadToCrm({ lead: mockLead({ field_data: [{ name: "full_name", values: ["X"] }] }), formName: "SQ8 Enquiry", pageId: TEST_PAGE_ID, settings: {} });
  check("falls back to the form name for the model", noModel.canonicalModel === "SQ8" && !noModel.phone && !noModel.email);
  const split = mapMetaLeadToCrm({ lead: mockLead({ field_data: [{ name: "first_name", values: ["Asha"] }, { name: "last_name", values: ["R"] }] }), formName: "", pageId: TEST_PAGE_ID, settings: {} });
  check("joins first_name + last_name when there is no full_name", split.name === "Asha R");

  // Throw-away company with one agent and the test page connected.
  const company = await Company.create({ name: "__meta-integration-test__", slug: `meta-test-${Date.now()}`, active: true });
  const cleanup = async () => {
    await Promise.all([
      Lead.deleteMany({ companyId: company._id }),
      MetaWebhookEvent.deleteMany({ pageId: TEST_PAGE_ID }),
      MetaWebhookEvent.deleteMany({ companyId: company._id }),
      Settings.deleteMany({ companyId: company._id }),
      Agent.deleteMany({ companyId: company._id }),
      Company.deleteOne({ _id: company._id }),
    ]);
  };

  try {
    const agent = await Agent.create({ name: "Test Agent", username: `meta-test-agent-${Date.now()}`, passwordHash: "x", companyId: company._id, active: true });
    await Settings.create({
      companyId: company._id,
      meta: { enabled: true, pages: [{ pageId: TEST_PAGE_ID, pageName: "Test Page", accessTokenEnc: encryptSecret("EAAtest-token"), tokenPreview: "EAAtes…oken", connectedAt: new Date() }] },
    });

    // Stub the Graph API. `graphMode` controls the scenario.
    const realFetch = global.fetch;
    let graphMode = "ok";
    let graphCalls = 0;
    const leadsById = {
      770000000000002: mockLead(),
      770000000000003: mockLead({ id: "770000000000003", platform: "ig", field_data: [{ name: "full_name", values: ["Insta Customer"] }, { name: "phone_number", values: ["+919000000002"] }] }),
      770000000000004: mockLead({ id: "770000000000004", field_data: [{ name: "full_name", values: ["No Phone"] }, { name: "email", values: ["nophone@example.com"] }, { name: "which_model_are_you_interested_in?", values: ["Q3"] }] }),
      770000000000005: mockLead({ id: "770000000000005", field_data: [{ name: "full_name", values: ["No Email"] }, { name: "phone_number", values: ["+919000000005"] }, { name: "which_model_are_you_interested_in?", values: ["Q7"] }] }),
      770000000000006: mockLead({ id: "770000000000006", field_data: [{ name: "full_name", values: ["Test Customer"] }, { name: "phone_number", values: ["+919000000001"] }, { name: "which_model_are_you_interested_in?", values: ["Q5"] }] }),
      770000000000007: mockLead({ id: "770000000000007", field_data: [{ name: "full_name", values: ["Later Success"] }, { name: "phone_number", values: ["+919000000007"] }] }),
    };
    global.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("graph.facebook.com")) return realFetch(input, init);
      graphCalls++;
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (graphMode === "down") return json(500, { error: { message: "Service temporarily unavailable", code: 2, type: "OAuthException-not" } });
      if (graphMode === "expired") return json(400, { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } });
      const id = url.split("/").pop().split("?")[0];
      if (id === "880000000000001") return json(200, { id, name: "Q5 Test Drive Form" });
      if (leadsById[id]) return json(200, leadsById[id]);
      return json(404, { error: { message: "Unsupported get request", code: 100 } });
    };

    try {
      // 1. Facebook lead → new CRM lead, auto-assigned.
      let results = await processWebhookPayload(leadgenPayload("770000000000002"));
      let lead = await Lead.findOne({ metaLeadId: "770000000000002" }).lean();
      check("Facebook leadgen event creates a lead", results[0].status === "processed" && !!lead, results[0].error);
      check("…with the existing status default and an assigned agent", lead?.status === "New" && String(lead?.assignedTo) === String(agent._id));
      check("…tagged platform/facebook, source Facebook, form + campaign names", lead?.platform === "facebook" && lead?.source === "Facebook" && lead?.metaFormName === "Q5 Test Drive Form" && lead?.campaign === "Q5 Sept Leads");
      check("…with an enquiry history entry (timeline) and lastEnquiryAt", lead?.enquiryHistory?.length === 1 && !!lead?.lastEnquiryAt);

      // 2. Duplicate webhook delivery → no second lead, no extra Graph call.
      const callsBefore = graphCalls;
      results = await processWebhookPayload(leadgenPayload("770000000000002"));
      const count = await Lead.countDocuments({ metaLeadId: "770000000000002" });
      check("redelivered webhook is idempotent (still exactly one lead)", count === 1 && results[0].status === "processed");
      check("…and does not call the Graph API again", graphCalls === callsBefore);

      // 3. Instagram lead.
      results = await processWebhookPayload(leadgenPayload("770000000000003"));
      lead = await Lead.findOne({ metaLeadId: "770000000000003" }).lean();
      check("Instagram lead is created with platform 'instagram' / source 'Instagram'", lead?.platform === "instagram" && lead?.source === "Instagram");

      // 4. Missing phone / 5. missing email.
      results = await processWebhookPayload(leadgenPayload("770000000000004"));
      lead = await Lead.findOne({ metaLeadId: "770000000000004" }).lean();
      check("lead with no phone is still created (email only)", results[0].status === "processed" && lead && !lead.phone && lead.email === "nophone@example.com");
      results = await processWebhookPayload(leadgenPayload("770000000000005"));
      lead = await Lead.findOne({ metaLeadId: "770000000000005" }).lean();
      check("lead with no email is still created (phone only)", results[0].status === "processed" && lead && lead.phone === "919000000005" && !lead.email);

      // 6. Same customer, same model, new submission → repeat enquiry, no new lead.
      results = await processWebhookPayload(leadgenPayload("770000000000006"));
      const original = await Lead.findOne({ metaLeadId: "770000000000002" }).lean();
      const extra = await Lead.findOne({ metaLeadId: "770000000000006" }).lean();
      check("repeat enquiry (same phone + model) folds into the existing lead", results[0].status === "duplicate" && !extra && original.duplicateCount === 1 && original.enquiryHistory.length === 2);

      // 7. Graph API down → event failed with error, then retried successfully.
      graphMode = "down";
      results = await processWebhookPayload(leadgenPayload("770000000000007"));
      check("Graph API failure leaves the event 'failed' with a message", results[0].status === "failed" && /unavailable/i.test(results[0].error || ""), results[0].error);
      check("…and no lead was created", !(await Lead.exists({ metaLeadId: "770000000000007" })));
      graphMode = "ok";
      const summary = await retryFailedEvents({ companyId: company._id, pageIds: [TEST_PAGE_ID] });
      check("retryFailedEvents() recovers it once the API is back", summary.processed === 1 && !!(await Lead.exists({ metaLeadId: "770000000000007" })), JSON.stringify(summary));

      // 8. Expired token → failed with a re-connect hint, recorded on settings.
      graphMode = "expired";
      results = await processWebhookPayload(leadgenPayload("770000000000008"));
      const s = await Settings.findOne({ companyId: company._id }).lean();
      check("expired token is reported clearly and stored as the company's last error", results[0].status === "failed" && /re-connect/i.test(results[0].error || "") && /expired/i.test(s.meta.lastError || ""), results[0].error);
      graphMode = "ok";

      // 9. Disabled connection.
      await Settings.updateOne({ companyId: company._id }, { $set: { "meta.enabled": false } });
      results = await processWebhookPayload(leadgenPayload("770000000000009"));
      check("a disabled connection refuses new leads without creating them", results[0].status === "failed" && /disabled/i.test(results[0].error || ""));
      await Settings.updateOne({ companyId: company._id }, { $set: { "meta.enabled": true } });

      // 10. Existing (non-Meta) lead creation + assignment still works through the same path.
      const assignNext = await createAgentAssigner(company._id);
      const plain = await dedupeAndCreateLead({ companyId: company._id, phone: "919000000099", name: "Sheet Style Lead", model: "Q3", canonicalModel: "Q3", data: {}, source: "Meta Ads", sheetCreatedAt: new Date(), assignNext });
      check("non-Meta lead creation via dedupeAndCreateLead still works and assigns", plain.status === "created" && String(plain.lead.assignedTo) === String(agent._id) && !plain.lead.platform);
    } finally {
      global.fetch = realFetch;
    }
  } finally {
    await cleanup();
    console.log("  (test company and all its leads/events removed)");
  }
  await mongoose.disconnect();
}

(async () => {
  try {
    await httpTests();
    await pipelineTests();
  } catch (err) {
    failed++;
    console.error("\n  ✗ test run crashed:", err);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
