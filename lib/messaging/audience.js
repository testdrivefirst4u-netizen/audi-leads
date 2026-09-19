const mongoose = require("mongoose");
const Lead = require("../../models/Lead");
const { bucketFilterValue, escapeRegExp } = require("../leadFields");

// Turns a Campaign.audience into a Mongo filter over the company's leads —
// the same vocabulary as the Leads page filters (pages/api/leads.js), so a
// dealer can build an audience exactly the way they already filter leads.
// Channel-specific exclusions (opt-out, missing contact detail, recently
// messaged) are applied here too, so the preview count on screen is the
// number that will actually be queued.

function baseFilter(companyId, audience = {}) {
  const filter = { companyId: new mongoose.Types.ObjectId(String(companyId)) };
  if (audience.model) filter.canonicalModel = audience.model;
  if (audience.status) filter.status = audience.status;
  if (audience.source) filter.source = audience.source;
  if (audience.platform === "other") filter.platform = { $in: ["", null] };
  else if (audience.platform) filter.platform = audience.platform;
  if (audience.location) filter.location = audience.location;
  if (audience.agent === "unassigned") filter.assignedTo = null;
  else if (audience.agent && mongoose.isValidObjectId(audience.agent)) filter.assignedTo = new mongoose.Types.ObjectId(audience.agent);
  if (audience.bucket) filter.bucket = bucketFilterValue(audience.bucket);
  if (audience.from || audience.to) {
    filter.sheetCreatedAt = {};
    if (audience.from) filter.sheetCreatedAt.$gte = new Date(`${audience.from}T00:00:00`);
    if (audience.to) {
      const end = new Date(`${audience.to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      filter.sheetCreatedAt.$lt = end;
    }
  }
  if (audience.search?.trim()) {
    const safe = escapeRegExp(audience.search.trim());
    filter.$or = [{ name: { $regex: safe, $options: "i" } }, { phone: { $regex: safe, $options: "i" } }, { email: { $regex: safe, $options: "i" } }];
  }
  if (audience.excludeStatuses?.length) {
    filter.status = filter.status ? { $eq: filter.status, $nin: audience.excludeStatuses } : { $nin: audience.excludeStatuses };
  }
  return filter;
}

function channelFilter(channel, audience = {}) {
  const f = {};
  if (channel === "whatsapp") {
    f.phone = { $exists: true, $nin: ["", null] };
    f.whatsappOptOut = { $ne: true };
  } else {
    f.email = { $exists: true, $regex: /@/ };
    f.emailOptOut = { $ne: true };
  }
  const days = Number(audience.excludeMessagedDays || 0);
  if (days > 0) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    f.$or = [{ lastMarketingAt: { $exists: false } }, { lastMarketingAt: null }, { lastMarketingAt: { $lt: since } }];
  }
  return f;
}

function audienceFilter(companyId, channel, audience) {
  const base = baseFilter(companyId, audience);
  const chan = channelFilter(channel, audience);
  // Both may use $or — combine with $and to keep both.
  if (base.$or && chan.$or) {
    const { $or: a, ...restBase } = base;
    const { $or: b, ...restChan } = chan;
    return { ...restBase, ...restChan, $and: [{ $or: a }, { $or: b }] };
  }
  return { ...base, ...chan };
}

async function previewAudience(companyId, channel, audience, sampleSize = 8) {
  const matchedAll = await Lead.countDocuments(baseFilter(companyId, audience));
  const filter = audienceFilter(companyId, channel, audience);
  const [eligible, sample] = await Promise.all([
    Lead.countDocuments(filter),
    Lead.find(filter).sort({ sheetCreatedAt: -1 }).limit(sampleSize).select("name phone email canonicalModel status location").lean(),
  ]);
  return { matched: matchedAll, eligible, excluded: Math.max(0, matchedAll - eligible), sample };
}

const AUDIENCE_KEYS = ["model", "status", "source", "platform", "location", "agent", "bucket", "from", "to", "search"];

// Whitelists and trims what the UI sends before it is stored on a Campaign.
function cleanAudience(a = {}) {
  const out = {};
  for (const k of AUDIENCE_KEYS) if (typeof a[k] === "string" && a[k].trim()) out[k] = a[k].trim();
  out.excludeMessagedDays = Math.max(0, Math.min(90, Number(a.excludeMessagedDays ?? 7) || 0));
  out.excludeStatuses = Array.isArray(a.excludeStatuses) ? a.excludeStatuses.map(String).filter(Boolean) : [];
  return out;
}

module.exports = { baseFilter, audienceFilter, previewAudience, cleanAudience, AUDIENCE_KEYS };
