// Single source of truth for the Excel/CSV import page's lead sources —
// each source's default channel and its own column-name aliases, replacing
// what used to be a hardcoded alias list duplicated across
// pages/api/leads/import.js and the page's own static "Recognized Columns"
// table. Adding an 11th source later is a new entry here, nothing else.
//
// A company can override any of a source's aliases via
// Settings.sourceColumnOverrides (see models/Settings.js) — e.g. "this
// company's Meta export calls the name column candidate_name" — without a
// code change; see guessColumnMapping below.

// The ordered list of CRM fields the import mapping screen offers, plus the
// label shown in dropdowns/preview tables and on the lead detail page.
export const CRM_FIELDS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "model", label: "Model" },
  { key: "location", label: "Location" },
  { key: "message", label: "Message" },
  { key: "createdDate", label: "Created Date" },
  { key: "campaign", label: "Campaign" },
  { key: "campaignId", label: "Campaign ID" },
  { key: "adSet", label: "Ad Set" },
  { key: "adSetId", label: "Ad Set ID" },
  { key: "ad", label: "Ad" },
  { key: "adId", label: "Ad ID" },
  { key: "utmSource", label: "UTM Source" },
  { key: "utmMedium", label: "UTM Medium" },
  { key: "utmCampaign", label: "UTM Campaign" },
  { key: "utmTerm", label: "UTM Term" },
  { key: "utmContent", label: "UTM Content" },
  { key: "landingPage", label: "Landing Page" },
];

// Fallback aliases every source can match on, regardless of platform —
// the same alias sets pages/api/leads/import.js hardcoded before this file
// existed, now centralized.
const COMMON_ALIASES = {
  name: ["name", "full_name", "customer_name", "customer"],
  phone: ["phone", "mobile", "phone_number", "contact", "contact_number"],
  email: ["email", "email_address"],
  model: ["model", "vehicle", "car_model", "product"],
  location: ["location", "showroom", "city"],
  message: ["message", "note", "remarks", "comment"],
  createdDate: ["created_time", "created_date", "created date", "date", "enquiry_date", "enquiry date"],
};

// Each source's platform-specific aliases, checked before COMMON_ALIASES —
// only fields with real platform-specific column names need an entry here;
// anything absent falls straight through to the common list above.
export const LEAD_SOURCES = [
  {
    slug: "meta_ads",
    name: "Meta Ads",
    channel: "Paid Social",
    aliases: {
      name: ["full_name"],
      phone: ["phone_number"],
      campaign: ["campaign_name"],
      campaignId: ["campaign_id"],
      adSet: ["adset_name"],
      adSetId: ["adset_id"],
      ad: ["ad_name"],
      adId: ["ad_id"],
    },
  },
  {
    slug: "google_ads",
    name: "Google Ads",
    channel: "Paid Search",
    aliases: {
      name: ["full_name"],
      phone: ["phone_number"],
      email: ["email_address"],
      campaign: ["campaign_name"],
      campaignId: ["campaign_id"],
      adSet: ["ad_group", "adgroup_name"],
      adId: ["ad_id"],
      createdDate: ["created_date", "created_time"],
    },
  },
  {
    slug: "linkedin",
    name: "LinkedIn",
    channel: "Paid Social",
    // Name is deliberately absent here — LinkedIn exports commonly split it
    // into first_name/last_name, which resolveName() in lib/leadFields.js
    // combines directly rather than through the single-column mapping UI.
    aliases: {
      campaign: ["campaign"],
      campaignId: ["campaign_id"],
      ad: ["creative"],
      createdDate: ["created_time"],
    },
  },
  {
    slug: "website",
    name: "Website",
    channel: "Organic / Direct",
    aliases: {
      utmSource: ["utm_source"],
      utmMedium: ["utm_medium"],
      utmCampaign: ["utm_campaign"],
      utmTerm: ["utm_term"],
      utmContent: ["utm_content"],
      landingPage: ["landing_page"],
    },
  },
  { slug: "whatsapp", name: "WhatsApp", channel: "Messaging", aliases: {} },
  { slug: "google_sheets", name: "Google Sheets", channel: "Other", aliases: {} },
  { slug: "walk_in", name: "Walk-in", channel: "Offline", aliases: {} },
  { slug: "phone", name: "Phone", channel: "Offline", aliases: {} },
  { slug: "referral", name: "Referral", channel: "Referral", aliases: {} },
  { slug: "other", name: "Other", channel: "Other", aliases: {} },
];

export function getLeadSource(slug) {
  return LEAD_SOURCES.find((s) => s.slug === slug) || null;
}

function normalizeHeader(h) {
  return String(h || "").toLowerCase().trim();
}

// Resolves the alias search list for one CRM field: a company override (if
// any) takes priority, then the source's own aliases, then the common
// fallback — first header match wins.
function aliasesFor(field, source, overrideMapping) {
  const list = [];
  if (overrideMapping?.[field]) list.push(overrideMapping[field]);
  if (source?.aliases?.[field]) list.push(...source.aliases[field]);
  if (COMMON_ALIASES[field]) list.push(...COMMON_ALIASES[field]);
  return list;
}

// Suggests a { crmFieldKey: excelHeader } mapping for a parsed file's
// headers, plus which headers went unclaimed. A header can only be claimed
// by one CRM field (first field in CRM_FIELDS order wins), so two similarly-
// named columns don't both fill the same slot.
export function guessColumnMapping(headers, sourceSlug, overrideMapping) {
  const source = getLeadSource(sourceSlug);
  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));
  const claimed = new Set();
  const suggestedMapping = {};

  for (const field of CRM_FIELDS) {
    const aliases = aliasesFor(field.key, source, overrideMapping).map(normalizeHeader);
    const match = normalizedHeaders.find((h) => !claimed.has(h.raw) && aliases.includes(h.normalized));
    if (match) {
      suggestedMapping[field.key] = match.raw;
      claimed.add(match.raw);
    } else {
      suggestedMapping[field.key] = null;
    }
  }

  const unmappedColumns = headers.filter((h) => !claimed.has(h));
  return { suggestedMapping, unmappedColumns };
}

function pick(row, header) {
  if (!header) return "";
  const value = row[header];
  return value !== undefined && value !== null ? String(value).trim() : "";
}

// LinkedIn (and similar) exports commonly split a contact's name across
// first_name/last_name rather than one combined column — if the confirmed
// mapping didn't resolve a `name` value, look for those two columns
// directly and combine them, rather than making every source-mapping UI
// support multi-column combining just for this one case.
function resolveName(row, mapping) {
  const mapped = pick(row, mapping.name);
  if (mapped) return mapped;

  const keys = Object.keys(row);
  const firstHeader = keys.find((k) => ["first_name", "firstname"].includes(normalizeHeader(k)));
  const lastHeader = keys.find((k) => ["last_name", "lastname"].includes(normalizeHeader(k)));
  return [pick(row, firstHeader), pick(row, lastHeader)].filter(Boolean).join(" ").trim();
}

// One shared row -> CRM-field-values extraction, used by both the parse
// preview and the real import endpoint so they can never drift apart —
// given a raw parsed row and a confirmed { crmFieldKey: excelHeader }
// mapping, returns the trimmed string value (or "") for every CRM field.
export function extractLeadFields(row, mapping) {
  const values = {};
  for (const field of CRM_FIELDS) {
    if (field.key === "name") continue;
    values[field.key] = pick(row, mapping?.[field.key]);
  }
  values.name = resolveName(row, mapping || {});
  return values;
}
