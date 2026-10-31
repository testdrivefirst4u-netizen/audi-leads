const mongoose = require("mongoose");
const connectDB = require("../../../lib/db");
const Lead = require("../../../models/Lead");
const { requireCompanyMemberOrSuperAdmin } = require("../../../lib/auth");
const { phoneVariants, digitsOnly } = require("../../../lib/phone");

// "Is this customer already in the CRM?" — asked by the "+ New lead" form
// (components/QuickAddLead.js) as soon as a phone number or email is typed,
// so a repeat customer is spotted before a second lead is created. Matches
// the phone in any of the shapes leads store it in.
//
// An agent learns that the customer exists (so they don't add a duplicate)
// and who has them, but can only open the lead if it's assigned to them —
// the same rule as everywhere else (lib/leadAccess.js).
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const phone = digitsOnly(req.query.phone);
  const email = String(req.query.email || "").trim().toLowerCase();
  if (phone.length < 8 && !email.includes("@")) return res.status(200).json({ matches: [] });

  await connectDB();
  const or = [];
  if (phone.length >= 8) or.push({ phone: { $in: phoneVariants(phone) } });
  if (email.includes("@")) or.push({ email });

  const leads = await Lead.find({ companyId: new mongoose.Types.ObjectId(req.session.companyId), $or: or })
    .select("name phone model canonicalModel status assignedTo updatedAt")
    .populate("assignedTo", "name")
    .sort({ updatedAt: -1 })
    .limit(3)
    .lean();

  const agentId = req.session.role === "agent" ? String(req.session.agentId) : null;
  res.status(200).json({
    matches: leads.map((l) => ({
      _id: l._id,
      name: l.name || "",
      phone: l.phone || "",
      model: l.canonicalModel || l.model || "",
      status: l.status || "New",
      agent: l.assignedTo?.name || "",
      canOpen: !agentId || String(l.assignedTo?._id || "") === agentId,
    })),
  });
}

export default requireCompanyMemberOrSuperAdmin(handler);
