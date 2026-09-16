const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const Settings = require("../../../../models/Settings");
const { requireCompanyMemberOrSuperAdmin } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { completeDueFollowUps } = require("../../../../lib/followUps");
const { invalidate } = require("../../../../lib/serverCache");
const { effectiveStatuses } = require("../../../../lib/leadFields");
const { sendStatusCallback } = require("../../../../lib/statusCallback");

async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { status } = req.body || {};

  await connectDB();

  // Validated against this company's own status list (Settings.statusOptions
  // when configured, else the app-wide default) — not the shared Lead
  // model's global default list, since that's no longer schema-enforced.
  const settings = await Settings.findOne({ companyId: req.session.companyId }).select("statusOptions").lean();
  const validStatuses = effectiveStatuses(settings?.statusOptions);
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const filter = leadOwnershipFilter(req.session, id);

  // Same reasoning as remarks.js/calls.js/followups — changing status is the
  // admin/agent actively working this lead, so any follow-up already due
  // (overdue or due today) is resolved by it.
  const followUpsCleared = await completeDueFollowUps(Lead, filter);

  const previousLead = await Lead.findOne(filter).select("status").lean();
  const lead = await Lead.findOneAndUpdate(filter, { status }, { new: true });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  if (followUpsCleared > 0) invalidate(`followup-tabs:${req.session.companyId}`);

  // Awaited (not fire-and-forget) — on Vercel's Node runtime, background
  // work started after the response is sent isn't guaranteed to finish, so
  // this has to complete before res.json() below. Bounded by
  // CALLBACK_TIMEOUT_MS inside sendStatusCallback (4s) and never throws — a
  // dead/slow partner endpoint shows up in that key's delivery logs, not as
  // a failure of the status change itself, which has already been saved.
  try {
    await sendStatusCallback(lead, status, previousLead?.status);
  } catch (err) {
    console.error("Status callback dispatch failed:", err);
  }

  res.status(200).json({ lead, followUpsCleared });
}

export default requireCompanyMemberOrSuperAdmin(handler);
