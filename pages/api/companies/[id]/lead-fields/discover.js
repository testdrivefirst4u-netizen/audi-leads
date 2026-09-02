const connectDB = require("../../../../../lib/db");
const Lead = require("../../../../../models/Lead");
const { requireSuperAdmin } = require("../../../../../lib/auth");

// How many of the most recently synced leads to scan for field keys — same
// "low hundreds of leads, fine to loop in JS" scale already assumed by the
// hot-leads/follow-up-tab computations in pages/api/leads.js and stats.js.
const SAMPLE_SIZE = 200;

// Lets a super admin see what raw fields actually showed up in a company's
// leads (varies per sheet/integration), so they can pick columns from real
// data instead of guessing field names or writing regex by hand — the admin
// UI turns a chosen key into a LeadFieldColumn's `matchers` entry.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await connectDB();
  const { id: companyId } = req.query;

  const leads = await Lead.find({ companyId })
    .sort({ sheetCreatedAt: -1 })
    .limit(SAMPLE_SIZE)
    .select("data")
    .lean();

  const examples = new Map(); // key -> first non-empty example value seen
  for (const lead of leads) {
    for (const [key, value] of Object.entries(lead.data || {})) {
      if (!examples.has(key) && value) {
        examples.set(key, String(value).slice(0, 80));
      }
    }
  }

  const fields = Array.from(examples.entries())
    .map(([key, example]) => ({ key, example }))
    .sort((a, b) => a.key.localeCompare(b.key));

  res.status(200).json({ fields, sampledLeads: leads.length });
}

export default requireSuperAdmin(handler);
