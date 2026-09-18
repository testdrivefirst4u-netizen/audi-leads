const Lead = require("../models/Lead");
const { fetchSheetRows } = require("./googleSheets");
const { getSettings, parseSheetRow, resolveTabs } = require("./syncService");
const { canonicalModelFor } = require("./leadFields");

// Reconciles a company's live Google Sheet(s) against what's actually in
// the CRM, row by row, and says exactly what happened to every row. This
// is the answer to "the sheet has 300 rows but I only see 280 leads" —
// the sync's own SyncLog only records counts, and a count can't tell you
// WHICH rows were skipped or why.
//
// Every sheet row lands in exactly one of these statuses:
//   imported  — it is a Lead's primary row (created a Lead of its own)
//   merged    — same customer + same model as an earlier row, so it was
//               folded into that Lead's enquiryHistory as a repeat enquiry
//               (this is the #1 reason a row "isn't a lead" — it IS in the
//               CRM, just not as a separate row)
//   skipped   — the sync deliberately never imports it (Meta test lead, or
//               no phone/lead ID to identify the customer)
//   missing   — a perfectly good row that is NOT in the CRM at all; the
//               next sync should pick it up — if it keeps showing up here
//               after a sync, something is wrong (see lastSync error)
//   duplicate — (a per-tab count + list, not a row status) more than one
//               Lead document claims the same tab+row: the same customer
//               was imported twice by overlapping sync runs before the
//               sync lock existed. Both records show in the Leads table
//               and inflate every count.
//   mismatch  — a Lead exists at this tab+row position, but it's a
//               different customer than the sheet row now holds: rows were
//               inserted/deleted/re-sorted above it in the sheet, so row
//               numbers shifted. Needs a human look — the sync keys on row
//               number and can't tell these apart on its own.
//
// Parsing/skip decisions come from lib/syncService.js's parseSheetRow, so
// this audit can never disagree with the sync about what's importable.

function pick(record, patterns) {
  const keys = Object.keys(record);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k));
    if (key && record[key]) return record[key];
  }
  return "";
}

// Audits ONE tab and returns { tab: summary, rows, duplicates }. The page
// calls this per tab (one short request each) so a company with 36 tabs
// never needs one 25-second request — which a serverless host would cut
// off — and can show progress as it goes. auditCompanyImport() below is
// the same thing looped, for callers that can afford the time.
async function auditTab(companyId, settings, sheetSource, tab) {
  const rows = [];
  const duplicates = [];
  const { records } = await fetchSheetRows(sheetSource.sheetId, tab);
  const canonicalModel = canonicalModelFor(tab);

  // Everything the CRM knows about this tab, in two lookups: leads whose
  // own row is in this tab, and leads that absorbed one of this tab's
  // rows as a repeat enquiry.
  const [primaryDocs, historyDocs] = await Promise.all([
    Lead.find({ companyId, model: tab }).select("rowNumber phone email name leadId sheetCreatedAt").lean(),
    Lead.find({ companyId, "enquiryHistory.model": tab }).select("name phone enquiryHistory").lean(),
  ]);
  // Oldest document wins as "the" lead for a row; any others sharing
  // the same row are duplicate records (see the duplicate note above).
  const primaryByRow = new Map();
  const docsByRow = new Map();
  for (const d of [...primaryDocs].sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
    if (!primaryByRow.has(d.rowNumber)) primaryByRow.set(d.rowNumber, d);
    if (!docsByRow.has(d.rowNumber)) docsByRow.set(d.rowNumber, []);
    docsByRow.get(d.rowNumber).push(d);
  }
  for (const [rowNumber, docs] of docsByRow) {
    if (docs.length > 1) {
      duplicates.push({
        tab,
        rowNumber,
        sheetRow: rowNumber + 1,
        name: docs[0].name || "",
        phone: docs[0].phone || "",
        count: docs.length,
        leadIds: docs.map((d) => String(d._id)),
      });
    }
  }
  const historyByRow = new Map();
  for (const doc of historyDocs) {
    const sorted = [...doc.enquiryHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((entry, idx) => {
      if (entry.model === tab) {
        historyByRow.set(entry.rowNumber, { lead: doc, enquiryNumber: idx + 1, totalEnquiries: sorted.length });
      }
    });
  }

  const tabSummary = { sheetId: sheetSource.sheetId, sheetLabel: sheetSource.label || "", tab, canonicalModel, ...emptyTotals() };
  const seenRows = new Set();

  for (const { rowNumber, record: rawRecord } of records) {
    seenRows.add(rowNumber);
    tabSummary.totalRows++;
    const parsed = parseSheetRow(rawRecord, settings);
    const base = {
      tab,
      sheetLabel: sheetSource.label || "",
      rowNumber,
      sheetRow: rowNumber + 1, // 1-based row in the actual sheet (row 1 is the header)
      name: parsed.name || pick(rawRecord, [/^name$/i, /full[_\s]*name/i, /customer/i]) || "",
      phone: parsed.phone || pick(rawRecord, [/phone/i, /mobile/i, /contact/i]) || "",
      email: parsed.email || pick(rawRecord, [/email/i]) || "",
      createdTime: pick(rawRecord, [/created[_\s]*time/i, /created/i, /^date$/i, /timestamp/i]) || "",
    };

    if (parsed.skipReason) {
      tabSummary.skipped++;
      rows.push({ ...base, status: "skipped", reason: parsed.skipReason });
      continue;
    }

    const primary = primaryByRow.get(rowNumber);
    if (primary) {
      // Same customer at this position? Phone is the sync's main identity
      // key; fall back to lead ID / email when the row has no phone.
      const sameCustomer =
        (parsed.phone && primary.phone === parsed.phone) ||
        (!parsed.phone && parsed.leadId && primary.leadId === parsed.leadId) ||
        (!parsed.phone && !parsed.leadId && parsed.email && primary.email === parsed.email);
      if (sameCustomer) {
        tabSummary.imported++;
        rows.push({ ...base, status: "imported", leadId: String(primary._id), leadName: primary.name || "" });
      } else {
        tabSummary.mismatch++;
        rows.push({
          ...base,
          status: "mismatch",
          leadId: String(primary._id),
          leadName: primary.name || "",
          leadPhone: primary.phone || "",
          reason: `CRM has "${primary.name || "?"}" (${primary.phone || "no phone"}) at this row — rows may have shifted in the sheet`,
        });
      }
      continue;
    }

    const merged = historyByRow.get(rowNumber);
    if (merged) {
      tabSummary.merged++;
      rows.push({
        ...base,
        status: "merged",
        leadId: String(merged.lead._id),
        leadName: merged.lead.name || "",
        reason: `Repeat enquiry #${merged.enquiryNumber} of ${merged.totalEnquiries} — same customer + same model, folded into the existing lead`,
      });
      continue;
    }

    tabSummary.missing++;
    rows.push({ ...base, status: "missing", reason: "Not in the CRM — will be created on the next sync" });
  }

  // Leads that point at a row this tab no longer has (deleted rows, or a
  // tab that shrank) — the CRM still has them, but their sheet link is
  // stale. Counted so the numbers reconcile; not listed as rows.
  tabSummary.orphaned = primaryDocs.filter((d) => !seenRows.has(d.rowNumber)).length;
  tabSummary.leadsInCrm = primaryDocs.length;
  tabSummary.duplicateLeads = [...docsByRow.values()].reduce((sum, docs) => sum + (docs.length - 1), 0);
  return { tab: tabSummary, rows, duplicates };
}

// The company's sheet tabs, in audit order: [{ sheetId, sheetLabel, tab }].
async function listAuditTabs(companyId) {
  const settings = await getSettings(companyId);
  const out = [];
  for (const sheetSource of settings.sheets || []) {
    const tabNames = await resolveTabs(sheetSource.sheetId, sheetSource.sheetName);
    for (const tab of tabNames) out.push({ sheetId: sheetSource.sheetId, sheetLabel: sheetSource.label || "", tab });
  }
  return { settings, tabs: out };
}

async function auditCompanyImport(companyId) {
  const settings = await getSettings(companyId);
  if (!settings.sheets || settings.sheets.length === 0) {
    return {
      auditedAt: new Date(),
      tabs: [],
      rows: [],
      duplicates: [],
      totals: emptyTotals(),
      error: "No Google Sheet configured for this company.",
    };
  }

  const tabs = [];
  const rows = [];
  const duplicates = [];

  for (const sheetSource of settings.sheets) {
    const tabNames = await resolveTabs(sheetSource.sheetId, sheetSource.sheetName);
    for (const tab of tabNames) {
      const r = await auditTab(companyId, settings, sheetSource, tab);
      tabs.push(r.tab);
      rows.push(...r.rows);
      duplicates.push(...r.duplicates);
    }
  }

  const totals = tabs.reduce((acc, t) => {
    for (const k of Object.keys(emptyTotals())) acc[k] += t[k] || 0;
    return acc;
  }, emptyTotals());

  return { auditedAt: new Date(), tabs, rows, duplicates, totals };
}

function emptyTotals() {
  return {
    totalRows: 0,
    imported: 0,
    merged: 0,
    skipped: 0,
    missing: 0,
    mismatch: 0,
    orphaned: 0,
    leadsInCrm: 0,
    duplicateLeads: 0,
  };
}

module.exports = { auditCompanyImport, auditTab, listAuditTabs, emptyTotals };
