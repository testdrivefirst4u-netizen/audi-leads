const mongoose = require("mongoose");

// Who changed what on a lead, and when — status moves (including drags on
// the Leads board), reassignments, edits, deletions and hand-added leads.
// Calls, remarks and follow-ups already live on the lead itself; this is the
// trail for the changes that otherwise overwrite a field. Written by
// lib/leadEvents.js; shown in a lead's window under "Change log".
const LeadEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    leadName: { type: String, default: "" }, // kept so a deleted lead's entries still read sensibly
    type: { type: String, enum: ["created", "status", "assigned", "edited", "deleted"], required: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    by: { type: String, default: "" }, // username
    role: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LeadEventSchema.index({ companyId: 1, leadId: 1, createdAt: -1 });

module.exports = mongoose.models.LeadEvent || mongoose.model("LeadEvent", LeadEventSchema);
