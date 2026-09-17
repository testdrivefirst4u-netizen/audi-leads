const mongoose = require("mongoose");
const Lead = require("../models/Lead");

// Shared by the Google Sheet sync (lib/syncService.js), the public
// lead-ingestion API (pages/api/public/leads.js), the Meta Lead Ads webhook
// (lib/meta/processEvent.js) and the Excel import (pages/api/leads/import.js)
// — same Rule 1/2/3 dedup policy regardless of where the lead came from: a
// new submission from a customer (phone/email match) already on file for
// the same canonicalModel folds into their enquiryHistory as a repeat
// enquiry; anything else becomes a new Lead document with normal
// auto-assignment.
//
// Two entry points with identical semantics:
//   dedupeAndCreateLead()      — one row, live lookups (sync / API / webhook)
//   bulkDedupeAndCreateLeads() — many rows in one go: ONE lookup for every
//                                phone/email in the batch, then insertMany
//                                + bulkWrite. Rows are still decided in
//                                file order, so a repeat enquiry later in
//                                the same file folds into the lead created
//                                earlier in it, exactly as the one-at-a-
//                                time path would have done.

// The Lead document for a brand-new lead. Every ingestion path builds it
// here so they can't drift apart.
function buildLeadDoc(args, { hasOtherLeads, enquiryDate, assignNext }) {
  const {
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
  } = args;
  return {
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
    // duplicate-merge branch, so a repeat enquiry can't overwrite the
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
    // Meta Lead Ads identifiers — same rule as the attribution fields.
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
  };
}

async function dedupeAndCreateLead(args) {
  const { companyId, phone, email, model, canonicalModel, rowNumber, source, sheetCreatedAt, assignNext } = args;
  const enquiryDate = sheetCreatedAt || new Date();
  const identityOr = [];
  if (phone) identityOr.push({ phone });
  if (email) identityOr.push({ email });

  const sameModelMatch = identityOr.length ? await Lead.findOne({ companyId, canonicalModel, $or: identityOr }) : null;

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
  const lead = await Lead.create(buildLeadDoc(args, { hasOtherLeads: Boolean(hasOtherLeads), enquiryDate, assignNext }));
  return { lead, status: "created" };
}

const INSERT_CHUNK = 500;

// `entries` is an array of the same argument objects dedupeAndCreateLead
// takes (minus assignNext), in file order. Returns one { status, leadId }
// per entry, same order; status is "created" or "duplicate".
async function bulkDedupeAndCreateLeads({ companyId, entries, assignNext }) {
  const phones = [...new Set(entries.map((e) => e.phone).filter(Boolean))];
  const emails = [...new Set(entries.map((e) => e.email).filter(Boolean))];
  const or = [];
  if (phones.length) or.push({ phone: { $in: phones } });
  if (emails.length) or.push({ email: { $in: emails } });

  // Everything already on file for any customer in this batch — one query.
  const existing = or.length ? await Lead.find({ companyId, $or: or }).select("_id phone email canonicalModel").lean() : [];

  const byPhone = new Map();
  const byEmail = new Map();
  const register = (doc) => {
    if (doc.phone) (byPhone.get(doc.phone) || byPhone.set(doc.phone, []).get(doc.phone)).push(doc);
    if (doc.email) (byEmail.get(doc.email) || byEmail.set(doc.email, []).get(doc.email)).push(doc);
  };
  existing.forEach(register);

  const results = [];
  const inserts = [];
  const repeats = new Map(); // leadId -> { entries: [...history entries], last: Date }

  for (const e of entries) {
    const enquiryDate = e.sheetCreatedAt || new Date();
    const candidates = [...(e.phone ? byPhone.get(e.phone) || [] : []), ...(e.email ? byEmail.get(e.email) || [] : [])];
    const sameModel = candidates.find((c) => c.canonicalModel === e.canonicalModel);

    if (sameModel) {
      const key = String(sameModel._id);
      const r = repeats.get(key) || { entries: [], last: enquiryDate };
      r.entries.push({ model: e.model, rowNumber: e.rowNumber, date: enquiryDate, source: e.source });
      if (enquiryDate > r.last) r.last = enquiryDate;
      repeats.set(key, r);
      results.push({ status: "duplicate", leadId: sameModel._id });
      continue;
    }

    const _id = new mongoose.Types.ObjectId();
    inserts.push({ _id, ...buildLeadDoc({ ...e, companyId }, { hasOtherLeads: candidates.length > 0, enquiryDate, assignNext }) });
    // Later rows in this same batch must see this lead exactly as if it
    // had been written already.
    register({ _id, phone: e.phone, email: e.email, canonicalModel: e.canonicalModel });
    results.push({ status: "created", leadId: _id });
  }

  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    // insertMany applies schema defaults (status "New", bucket, etc.) just
    // like create(); ordered:false keeps going past any single bad row.
    await Lead.insertMany(inserts.slice(i, i + INSERT_CHUNK), { ordered: false });
  }
  if (repeats.size > 0) {
    await Lead.bulkWrite(
      [...repeats].map(([id, r]) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $push: { enquiryHistory: { $each: r.entries } },
            $inc: { duplicateCount: r.entries.length }, // keeps duplicateCount === enquiryHistory.length - 1
            $max: { lastEnquiryAt: r.last },
          },
        },
      })),
      { ordered: false }
    );
  }
  return results;
}

module.exports = { dedupeAndCreateLead, bulkDedupeAndCreateLeads, buildLeadDoc };
