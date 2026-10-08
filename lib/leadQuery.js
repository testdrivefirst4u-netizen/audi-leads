// The Leads page's filter rules, shared by the table (pages/api/leads.js) and
// "Export to Excel" (pages/api/leads/export.js) so an export always contains
// exactly the leads the table is showing. Before this lived in one place
// only, the export silently ignored search, the follow-up tabs, Hot leads and
// the platform/form/ad filters and exported every lead instead.
const Lead = require("../models/Lead");
const { pickField, FIELD_MATCHERS, isUrgentTimeline, nextFollowUp, bucketFilterValue, escapeRegExp } = require("./leadFields");

// Mongo filter for every plain filter the Leads page has. Agents are always
// scoped to their own leads; sessions with no role are treated as admin.
function baseLeadFilter(query, session) {
  const {
    search = "",
    model = "",
    status = "",
    location = "",
    source = "",
    channel = "",
    campaign = "",
    platform = "",
    form = "",
    ad = "",
    bucket = "",
    from = "",
    to = "",
    agent = "",
  } = query || {};

  const filter = { companyId: session.companyId };
  if (search) {
    // Escaped so a search term containing regex syntax is matched literally
    // instead of either erroring or, worse, hanging the query on a crafted
    // catastrophic-backtracking pattern.
    const safeSearch = escapeRegExp(search);
    filter.$or = ["name", "phone", "email", "leadId", "model", "canonicalModel"].map((field) => ({
      [field]: { $regex: safeSearch, $options: "i" },
    }));
  }
  if (model) filter.canonicalModel = model;
  if (status) filter.status = status;
  if (location) filter.location = location === "unfilled" ? { $in: [null, ""] } : location;
  if (source) filter.source = source;
  if (channel) filter.channel = channel;
  if (campaign) filter.campaign = campaign;
  // Meta Lead Ads: "facebook" | "instagram" | "other" (non-Meta sources)
  if (platform === "other") filter.platform = { $in: ["", null] };
  else if (platform) filter.platform = platform;
  if (form) filter.metaFormName = form;
  if (ad) filter.ad = ad;
  if (bucket) filter.bucket = bucketFilterValue(bucket);
  // Filters on sheetCreatedAt — the date the lead actually came in on the
  // sheet (its own create_time column), not when we happened to sync it.
  if (from || to) {
    filter.sheetCreatedAt = {};
    if (from) filter.sheetCreatedAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.sheetCreatedAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (session.role === "agent") filter.assignedTo = session.agentId;
  else if (agent) filter.assignedTo = agent === "unassigned" ? null : agent;
  return filter;
}

// Follow-up tabs (Overdue/Due Today/Upcoming/Completed): which tab a lead is
// in depends on its soonest *pending* follow-up, computed in JS by
// nextFollowUp, so it can't be a plain Mongo filter. Returns the tab counts
// and the lead ids in each tab.
async function followUpBuckets(filter) {
  const candidates = await Lead.find({ ...filter, "followUps.0": { $exists: true } }).select("followUps").lean();
  const tabs = { overdue: 0, today: 0, upcoming: 0, completed: 0 };
  const ids = { overdue: [], today: [], upcoming: [], completed: [] };
  for (const l of candidates) {
    const info = nextFollowUp(l);
    if (info && tabs[info.status] !== undefined) {
      tabs[info.status]++;
      ids[info.status].push(l._id);
    }
    if ((l.followUps || []).some((f) => f.completed)) {
      tabs.completed++;
      ids.completed.push(l._id);
    }
  }
  return { followUpTabs: tabs, bucketIds: ids };
}

// "Hot" leads: still New, never remarked on or called, and an urgent
// purchase timeline — the timeline answer lives under a different raw column
// per sheet tab, so that last part is checked in JS (isHotLead). As on the
// Leads page, the Status and Bucket filters don't apply to this view.
function hotCandidateFilter(filter) {
  // eslint-disable-next-line no-unused-vars
  const { bucket, status, _id, ...rest } = filter;
  return { ...rest, status: "New", "remarks.0": { $exists: false }, "calls.0": { $exists: false } };
}

function isHotLead(lead) {
  return isUrgentTimeline(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline));
}

module.exports = { baseLeadFilter, followUpBuckets, hotCandidateFilter, isHotLead };
