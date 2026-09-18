const { canonicalModelFor, normalizeShowroom, resolveLocation, applySourceMap } = require("../leadFields");
const { normalizePhoneDigits } = require("../syncService");

// Pure mapping from a Graph API Lead node (plus the form's name) to the
// arguments lib/leadIngest.js's dedupeAndCreateLead expects — no I/O, so
// it's unit-testable with mock leads (see the test script in README).
//
// Meta lead forms are free-form: the standard questions arrive under fixed
// keys (full_name, email, phone_number, city, …) but any custom question
// arrives under whatever key the form builder generated (usually the
// question text, lower-cased with underscores). All of them, standard and
// custom, are kept verbatim in the lead's `data` map so they show up in the
// lead detail's "Sheet Details" section and can be surfaced as extra table
// columns with the existing per-company Table Columns config.

function firstValue(fieldData, patterns) {
  for (const pattern of patterns) {
    const entry = (fieldData || []).find((f) => pattern.test(f.name || ""));
    const value = entry?.values?.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (value !== undefined) return String(value).trim();
  }
  return "";
}

function fieldDataToObject(fieldData) {
  const out = {};
  for (const f of fieldData || []) {
    if (!f?.name) continue;
    const values = (f.values || []).map((v) => (v === null || v === undefined ? "" : String(v).trim())).filter(Boolean);
    out[f.name] = values.length > 1 ? values.join(", ") : values[0] || "";
  }
  return out;
}

function platformOf(lead) {
  const p = String(lead?.platform || "").toLowerCase();
  if (p === "ig" || p === "instagram") return "instagram";
  return "facebook"; // Meta reports "fb" (or omits the field on old leads)
}

function sourceLabelFor(platform) {
  return platform === "instagram" ? "Instagram" : "Facebook";
}

// Which vehicle model this enquiry is about. Preference order: an explicit
// model question on the form, then the form's own name (companies usually
// run one form per model, e.g. "Q5 Test Drive"), then the campaign name.
// canonicalModelFor() folds any of those to the CRM's model vocabulary; a
// value it doesn't recognise is kept verbatim (same rule as the public API)
// so a non-Audi company's own naming still shows up in filters and charts.
function resolveModel(lead, data, formName) {
  // A form answer counts only when its VALUE is a recognisable model (e.g.
  // "Q5") — many forms have questions like "when will you purchase your
  // vehicle?" whose answers ("within_15_days") must never become the model.
  const answered = (lead.field_data || []).filter((f) => /model|vehicle|car|interested/i.test(f.name || ""));
  for (const f of answered) {
    const v = (f.values || []).find((x) => x && String(x).trim());
    if (v && canonicalModelFor(String(v)) !== "Other") return { model: String(v).trim(), canonicalModel: canonicalModelFor(String(v)) };
  }
  // Then the form name, then the campaign / ad set / ad names — whichever
  // first names a known model. Otherwise keep the form name verbatim (or
  // the campaign), which the Leads filters will show as its own value.
  for (const candidate of [formName, lead.campaign_name, lead.adset_name, lead.ad_name]) {
    if (candidate && canonicalModelFor(candidate) !== "Other") return { model: candidate, canonicalModel: canonicalModelFor(candidate) };
  }
  const raw = formName || lead.campaign_name || "Meta Lead Ads";
  return { model: raw, canonicalModel: raw };
}

// Meta's Lead Ads Testing Tool fills every answer with a placeholder like
// "<test lead: dummy data for full_name>" — the sheet sync already skips
// those rows (lib/syncService.js isTestLead); the webhook must not turn
// them into leads either.
function isMetaTestLead(lead) {
  return (lead?.field_data || []).some((f) => (f.values || []).some((v) => typeof v === "string" && /test lead:\s*dummy data/i.test(v)));
}

function mapMetaLeadToCrm({ lead, formName = "", pageId, settings }) {
  const fieldData = Array.isArray(lead.field_data) ? lead.field_data : [];
  const data = fieldDataToObject(fieldData);

  const fullName = firstValue(fieldData, [/^full_name$/i, /^name$/i]);
  const firstName = firstValue(fieldData, [/^first_name$/i]);
  const lastName = firstValue(fieldData, [/^last_name$/i]);
  const name = fullName || [firstName, lastName].filter(Boolean).join(" ").trim();

  const phone = normalizePhoneDigits(firstValue(fieldData, [/^phone_number$/i, /^work_phone_number$/i, /phone/i, /mobile/i, /contact/i]));
  const email = firstValue(fieldData, [/^email$/i, /^work_email$/i, /e-?mail/i]).toLowerCase();
  const city = firstValue(fieldData, [/^city$/i, /^state$/i, /location/i, /showroom/i, /^branch$/i]);

  const platform = platformOf(lead);
  const { model, canonicalModel } = resolveModel(lead, data, formName);

  // Same location resolution the sheet sync / public API apply: a company
  // with its own Settings.locationField reads that raw field; otherwise the
  // showroom-city normaliser runs over the city/state answer.
  const location = settings?.locationField ? resolveLocation(data, settings.locationField) || normalizeShowroom(city) : normalizeShowroom(city);

  const createdAt = lead.created_time ? new Date(lead.created_time) : new Date();

  return {
    name,
    phone: phone || undefined,
    email: email || undefined,
    model,
    canonicalModel,
    data: {
      ...data,
      // Ids/names that aren't form answers but are useful to see alongside
      // them in the raw-details view.
      meta_platform: platform,
      meta_form_name: formName || "",
      meta_campaign_name: lead.campaign_name || "",
      meta_adset_name: lead.adset_name || "",
      meta_ad_name: lead.ad_name || "",
      meta_is_organic: lead.is_organic ? "yes" : "no",
    },
    source: applySourceMap(sourceLabelFor(platform), settings?.sourceMap),
    channel: "Paid Social",
    campaign: lead.campaign_name || undefined,
    campaignId: lead.campaign_id || undefined,
    adSet: lead.adset_name || undefined,
    adSetId: lead.adset_id || undefined,
    ad: lead.ad_name || undefined,
    adId: lead.ad_id || undefined,
    location: location || undefined,
    sheetCreatedAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    platform,
    metaLeadId: String(lead.id),
    metaPageId: pageId ? String(pageId) : undefined,
    metaFormId: lead.form_id ? String(lead.form_id) : undefined,
    metaFormName: formName || undefined,
    metaCreatedTime: Number.isNaN(createdAt.getTime()) ? undefined : createdAt,
    leadId: String(lead.id),
  };
}

module.exports = { mapMetaLeadToCrm, fieldDataToObject, platformOf, isMetaTestLead };
