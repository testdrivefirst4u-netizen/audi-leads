const LeadEvent = require("../models/LeadEvent");

// Records an entry in a lead's change log (models/LeadEvent.js). Awaited by
// callers (Vercel doesn't guarantee work after the response), but never
// throws: a logging hiccup must not fail the change it describes.
async function recordLeadEvent(req, { lead, type, from = "", to = "" }) {
  if (!lead?._id) return;
  try {
    await LeadEvent.create({
      companyId: lead.companyId || req.session.companyId,
      leadId: lead._id,
      leadName: lead.name || "",
      type,
      from: String(from ?? ""),
      to: String(to ?? ""),
      by: req.session.username || "",
      role: req.session.role || "",
    });
  } catch (err) {
    console.error("Lead event not recorded:", err.message);
  }
}

module.exports = { recordLeadEvent };
