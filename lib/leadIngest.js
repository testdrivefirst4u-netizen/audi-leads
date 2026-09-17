const Lead = require("../models/Lead");

// Shared by both the Google Sheet sync (lib/syncService.js) and the public
// lead-ingestion API (pages/api/public/leads.js) — same Rule 1/2/3 dedup
// policy regardless of where the lead came from: a new submission from a
// customer (phone/email match) already on file for the same canonicalModel
// folds into their enquiryHistory as a repeat enquiry; anything else becomes
// a new Lead document with normal auto-assignment.
async function dedupeAndCreateLead({
  companyId,
  leadId,
  phone,
  email,
  name,
  model,
  canonicalModel,
  data,
  source,
  sheetCreatedAt,
  location,
  rowNumber,
  contentHash,
  assignNext,
  apiKeyId,
  channel,
  campaign,
  campaignId,
  adSet,
  adSetId,
  ad,
  adId,
  utmSource,
  utmMedium,
  utmCampaign,
  utmTerm,
  utmContent,
  landingPage,
  platform,
  metaLeadId,
  metaPageId,
  metaFormId,
  metaFormName,
  metaCreatedTime,
}) {
  const enquiryDate = sheetCreatedAt || new Date();
  const identityOr = [];
  if (phone) identityOr.push({ phone });
  if (email) identityOr.push({ email });

  const sameModelMatch = identityOr.length
    ? await Lead.findOne({ companyId, canonicalModel, $or: identityOr })
    : null;

  if (sameModelMatch) {
    sameModelMatch.enquiryHistory.push({ model, rowNumber, date: enquiryDate, source });
    sameModelMatch.duplicateCount = sameModelMatch.enquiryHistory.length - 1;
    sameModelMatch.lastEnquiryAt = enquiryDate;
    // Agent assignment is deliberately left untouched — a repeat enquiry for
    // the same model stays with whoever already has it.
    await sameModelMatch.save();
    return { lead: sameModelMatch, status: "duplicate" };
  }

  const hasOtherLeads = identityOr.length ? await Lead.exists({ companyId, $or: identityOr }) : false;
  const lead = await Lead.create({
    companyId,
    leadId: leadId || undefined,
    phone: phone || undefined,
    name,
    email,
    model,
    canonicalModel,
    data,
    source,
    rowNumber,
    contentHash,
    apiKeyId: apiKeyId || undefined,
    // Marketing attribution — only ever set on a brand-new lead, never on the
    // duplicate-merge branch above, so a repeat enquiry can't overwrite the
    // original lead's source attribution (same reasoning as assignedTo being
    // left untouched there).
    channel: channel || undefined,
    campaign: campaign || undefined,
    campaignId: campaignId || undefined,
    adSet: adSet || undefined,
    adSetId: adSetId || undefined,
    ad: ad || undefined,
    adId: adId || undefined,
    utmSource: utmSource || undefined,
    utmMedium: utmMedium || undefined,
    utmCampaign: utmCampaign || undefined,
    utmTerm: utmTerm || undefined,
    utmContent: utmContent || undefined,
    landingPage: landingPage || undefined,
    // Meta Lead Ads identifiers — same rule as the attribution fields: only
    // ever set on the brand-new lead, never on a repeat-enquiry merge.
    platform: platform || undefined,
    metaLeadId: metaLeadId || undefined,
    metaPageId: metaPageId || undefined,
    metaFormId: metaFormId || undefined,
    metaFormName: metaFormName || undefined,
    metaCreatedTime: metaCreatedTime || undefined,
    sheetCreatedAt: sheetCreatedAt || undefined,
    location: location || undefined,
    leadType: hasOtherLeads ? "new_model_existing_customer" : "new",
    lastEnquiryAt: enquiryDate,
    enquiryHistory: [{ model, rowNumber, date: enquiryDate, source }],
    assignedTo: assignNext(location),
  });
  return { lead, status: "created" };
}

module.exports = { dedupeAndCreateLead };
