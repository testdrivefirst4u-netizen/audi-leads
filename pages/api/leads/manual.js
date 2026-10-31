const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const Settings = require("../../../models/Settings");
const Lead = require("../../../models/Lead");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { createAgentAssigner, normalizePhoneDigits } = require("../../../lib/syncService");
const { dedupeAndCreateLead } = require("../../../lib/leadIngest");
const { canonicalModelFor, applySourceMap } = require("../../../lib/leadFields");
const { invalidate } = require("../../../lib/serverCache");
const { storedPhone, phoneVariants } = require("../../../lib/phone");
const { recordLeadEvent } = require("../../../lib/leadEvents");

// Where a hand-entered lead came from — the walk-ins and calls that never
// pass through a sheet, Meta form or partner API.
const MANUAL_SOURCES = ["Walk-in", "Phone call", "Referral", "Other"];

// A lead typed in from the top bar's "+ New" (components/QuickAddLead.js).
// Goes through the same duplicate handling as every other source
// (lib/leadIngest.js): the same phone/email enquiring about the same model is
// recorded as a repeat enquiry on the existing lead, not a second lead.
// An agent's own entries are assigned to them; an admin's go through the
// company's normal round-robin assignment.
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  await connectDB();

  const body = req.body || {};
  const name = String(body.name || "").trim();
  const typedPhone = normalizePhoneDigits(body.phone);
  const email = String(body.email || "").trim().toLowerCase();
  const modelRaw = String(body.model || "").trim() || "General Enquiry";
  const note = String(body.note || "").trim();
  const sourceLabel = MANUAL_SOURCES.includes(body.source) ? body.source : "Walk-in";

  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!typedPhone && !email) return res.status(400).json({ error: "Add a phone number or an email" });
  if (typedPhone && (typedPhone.length < 8 || typedPhone.length > 15)) return res.status(400).json({ error: "That phone number doesn't look right" });

  const companyId = new mongoose.Types.ObjectId(req.session.companyId);
  const matchedModel = canonicalModelFor(modelRaw);
  const canonicalModel = matchedModel === "Other" ? modelRaw : matchedModel;
  const settings = await Settings.findOne({ companyId }).select("sourceMap").lean();

  // Phones are stored in mixed shapes across sources (Meta keeps "91…", sheets
  // and hand entries are 10 digits). If this customer already has a lead for
  // this model under another shape, reuse that exact string so the shared
  // duplicate check (exact match) recognises them; otherwise store the CRM's
  // own 10-digit form.
  let phone = typedPhone ? storedPhone(typedPhone) : "";
  if (typedPhone) {
    const existing = await Lead.findOne({ companyId, canonicalModel, phone: { $in: phoneVariants(typedPhone) } })
      .select("phone")
      .lean();
    if (existing?.phone) phone = existing.phone;
  }
  const source = applySourceMap(sourceLabel, settings?.sourceMap);

  const assignNext =
    req.session.role === "agent" && req.session.agentId
      ? () => new mongoose.Types.ObjectId(req.session.agentId)
      : await createAgentAssigner(companyId);

  try {
    const { lead, status } = await dedupeAndCreateLead({
      companyId,
      phone: phone || undefined,
      email: email || undefined,
      name,
      model: modelRaw,
      canonicalModel,
      data: { name, phone, email, model: modelRaw, message: note, enteredBy: req.session.username, entry: "manual" },
      source,
      sheetCreatedAt: new Date(),
      location: "",
      assignNext,
    });
    invalidate(`leads-meta:${req.session.companyId}`);
    await recordLeadEvent(req, { lead, type: "created", to: status === "duplicate" ? `repeat enquiry (${sourceLabel})` : sourceLabel });
    return res.status(201).json({ status, leadId: lead._id, phone: lead.phone || "", name: lead.name || name });
  } catch (err) {
    return res.status(500).json({ error: "Couldn't save the lead" });
  }
}

export default requireCompanyMemberOrSuperAdmin(handler);

