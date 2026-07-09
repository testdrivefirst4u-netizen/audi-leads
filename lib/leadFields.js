// Sheet column names vary slightly per model tab (e.g. "any_plan_to_exchange"
// vs "any_plan_to_exchange_your_existing_vehicle?"), so table columns are
// resolved by regex against whatever headers each row actually has.
export function pickField(data, patterns) {
  if (!data) return "";
  const keys = Object.keys(data);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k));
    if (key && data[key]) return data[key];
  }
  return "";
}

export const FIELD_MATCHERS = {
  createdTime: [/created_time/i],
  campaign: [/campaign_name/i],
  purchaseTimeline: [/when_are_you_planning_to_purchase/i],
  exchangePlan: [/any_plan_to_exchange/i],
  showroom: [/showroom|preferred.*location/i],
};

// "within_1_month" -> "Within 1 Month"
export function prettify(value) {
  if (!value) return "";
  return value
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MODEL_COLORS = {
  A6: { bg: "#eef2ff", text: "#4338ca" },
  Q3: { bg: "#ecfdf5", text: "#047857" },
  Q5: { bg: "#fff7ed", text: "#c2410c" },
  Q7: { bg: "#fef2f2", text: "#b91c1c" },
  SQ8: { bg: "#f5f3ff", text: "#6d28d9" },
  "Master Leads": { bg: "#f0fdfa", text: "#0f766e" },
  Service: { bg: "#f8fafc", text: "#475569" },
  Other: { bg: "#f8fafc", text: "#64748b" },
};

// The sheet has 20+ tabs (A6, Q3, Q5, Q7, SQ8, plus per-campaign variants
// like "Q5 jun", "q5 jun 26", "Q5Remareting jun") that all represent the same
// handful of real models. This folds any tab name down to one of a small,
// stable set of canonical categories for filtering/charting/reporting —
// hardcoded against the tab names seen so far; update if new tabs show up
// that don't match any of these substrings (falls through to "Other").
export function canonicalModelFor(tabName) {
  if (!tabName) return "Other";
  const t = tabName.toLowerCase();
  if (t.includes("master")) return "Master Leads";
  if (t.includes("premonsoon") || t.includes("service")) return "Service";
  if (t.includes("sq8")) return "SQ8";
  if (t.includes("q3")) return "Q3";
  if (t.includes("q5")) return "Q5";
  if (t.includes("q7")) return "Q7";
  if (t.includes("a6")) return "A6";
  return "Other";
}

// Consistent color per model — a known palette for the usual Audi models,
// falling back to a hash-derived hue so any new/unexpected tab still gets a
// stable (not random-per-render) color instead of all looking the same gray.
export function modelColor(model) {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model];
  let hash = 0;
  for (let i = 0; i < (model || "").length; i++) {
    hash = model.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return { bg: `hsl(${hue}, 70%, 95%)`, text: `hsl(${hue}, 55%, 32%)` };
}

const AVATAR_COLORS = ["#3d5afe", "#12b76a", "#d48806", "#e5484d", "#6d28d9", "#0891b2"];

// Same idea for the name-avatar initials circle: stable color derived from the name.
export function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Keep in sync with models/Lead.js's LEAD_STATUSES — duplicated here because
// this file is imported by client components, which can't require() a
// Mongoose model.
export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Won", "Lost"];

const STATUS_COLORS = {
  New: { bg: "#f1f5f9", text: "#475569" },
  Contacted: { bg: "#fffbeb", text: "#b45309" },
  Qualified: { bg: "#ecfdf5", text: "#047857" },
  Won: { bg: "#eff6ff", text: "#1d4ed8" },
  Lost: { bg: "#fef2f2", text: "#b91c1c" },
};

export function statusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.New;
}

// A lead counts as high-urgency if its purchase-timeline answer suggests a
// near-term buy (used to build the "Hot Leads" view: urgent + not yet touched).
export function isUrgentTimeline(value) {
  if (!value) return false;
  return /within_(1_month|15_days|in_week|24_hours)|immediately|this_week|asap|as_soon_as_possible/i.test(
    value.toString()
  );
}

// Classifies a lead's soonest pending follow-up into overdue/today/upcoming,
// matching the same bucketing FollowUpsCard uses for the dashboard summary.
export function nextFollowUp(lead) {
  const pending = (lead.followUps || [])
    .filter((f) => !f.completed)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!pending.length) return null;

  const date = new Date(pending[0].date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let status = "upcoming";
  if (day < today) status = "overdue";
  else if (day < tomorrow) status = "today";

  return { date, status };
}
