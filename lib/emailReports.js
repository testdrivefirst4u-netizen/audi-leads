const Lead = require("../models/Lead");
const Settings = require("../models/Settings");
const Company = require("../models/Company");
const EmailReportLog = require("../models/EmailReportLog");
const { sendMail } = require("./mailer");
const { effectiveStatuses, statusChartColor, bucketChartColor, prettyBucket, BUCKETS } = require("./leadFields");
const { categoricalColor } = require("./chartPalette");

// Day-wise, per-company Dashboard report emails — a snapshot of the same
// KPI cards and charts the company's Dashboard shows, as of a given date,
// with every chart covering the 1st of that month through that date. No
// individual leads are included. Everything here is scoped to a single
// companyId — a company only ever receives a report built from its own
// leads, and the recipient list comes from that company's own
// Settings.emailReports config (managed by the super admin in the
// Companies panel). Two entry points:
//   sendDailyReport()     — one company, one date (manual "Send now", tests)
//   runScheduledReports() — every opted-in company, called by the cron route
//
// "Lead received on day D" means sheetCreatedAt falls within D in the
// company's report timezone — the same field the Dashboard's "New Leads
// Today" uses, so the emailed numbers match what the company sees on screen.

const DEFAULT_TIMEZONE = "Asia/Kolkata";

// ---- timezone helpers ---------------------------------------------------
// The app has no date library; these do the one thing needed here — turn a
// "YYYY-MM-DD" in an IANA zone into the UTC instant the day starts — using
// Intl, which Node ships with full tz data for.

function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((part) => [part.type, part.value]));
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return (asUTC - date.getTime()) / 60000;
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function startOfDayInTz(dateStr, timeZone) {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

// "YYYY-MM-DD" of the given instant as seen in the zone.
function dateStrInTz(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(date); // en-CA formats as YYYY-MM-DD
}

function hourInTz(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" });
  return Number(dtf.format(date));
}

function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function formatDateLong(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
}

function formatMonthLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
}

// ---- config -------------------------------------------------------------

function normalizeConfig(raw) {
  const c = raw || {};
  return {
    recipients: Array.isArray(c.recipients) ? c.recipients : [],
    dailyEnabled: Boolean(c.dailyEnabled),
    sendHour: Number.isInteger(c.sendHour) ? c.sendHour : 9,
    coverage: c.coverage === "today" ? "today" : "yesterday",
    timezone: c.timezone && isValidTimeZone(c.timezone) ? c.timezone : DEFAULT_TIMEZONE,
    lastScheduledDate: c.lastScheduledDate || "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s) {
  return EMAIL_RE.test(s);
}

// ---- report data --------------------------------------------------------
// Mirrors what pages/api/stats.js computes for the Dashboard with its Month
// filter applied, so the emailed numbers are the same ones the company sees
// on screen for that month: every KPI card and chart covers the 1st of the
// report date's month through the report date — the report a company gets
// on the 15th is its month-to-date picture. Only the small all-time
// footnote reaches outside that window.

const FUNNEL_ORDER = ["New", "Contacted", "Qualified", "Test Drive", "Booking", "Retail (Converted)"];
const TOP_N = 8;

function toSortedArray(obj) {
  return Object.entries(obj)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// Same fold-the-tail rule as components/BarListChart.js.
function consolidate(rows) {
  if (rows.length <= TOP_N) return rows;
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N).reduce((sum, r) => sum + r.count, 0);
  const existingOther = top.find((r) => r.label === "Other");
  if (existingOther) return top.map((r) => (r.label === "Other" ? { ...r, count: r.count + rest } : r));
  return [...top, { label: "Other", count: rest }];
}

async function buildDailyReport(companyId, dateStr, timeZone) {
  const dayStart = startOfDayInTz(dateStr, timeZone);
  const dayEnd = startOfDayInTz(shiftDateStr(dateStr, 1), timeZone);
  const prevStart = startOfDayInTz(shiftDateStr(dateStr, -1), timeZone);
  const monthStartStr = `${dateStr.slice(0, 7)}-01`;
  const monthStart = startOfDayInTz(monthStartStr, timeZone);

  const base = { companyId };
  // Repeat enquiries that landed on a day without creating a lead — every
  // enquiryHistory entry dated that day (same-row artefacts collapsed),
  // minus the leads created that day, whose first entry is that same date.
  async function enquiriesBetween(start, end) {
    const rows = await Lead.aggregate([
      { $match: { ...base, lastEnquiryAt: { $gte: start } } },
      { $unwind: "$enquiryHistory" },
      { $match: { "enquiryHistory.date": { $gte: start, $lt: end } } },
      { $group: { _id: { lead: "$_id", model: "$enquiryHistory.model", row: "$enquiryHistory.rowNumber" } } },
      { $count: "n" },
    ]);
    return rows[0]?.n || 0;
  }

  const [allTimeUnique, leadsOnDay, previousDay, monthLeads, settings, enquiriesOnDay, enquiriesPrevDay] = await Promise.all([
    Lead.countDocuments({ ...base, sheetCreatedAt: { $lt: dayEnd } }),
    Lead.countDocuments({ ...base, sheetCreatedAt: { $gte: dayStart, $lt: dayEnd } }),
    Lead.countDocuments({ ...base, sheetCreatedAt: { $gte: prevStart, $lt: dayStart } }),
    Lead.find({ ...base, sheetCreatedAt: { $gte: monthStart, $lt: dayEnd } })
      .select("status bucket source campaign model canonicalModel sheetCreatedAt duplicateCount calls")
      .lean(),
    Settings.findOne({ companyId }).select("statusOptions").lean(),
    enquiriesBetween(dayStart, dayEnd),
    enquiriesBetween(prevStart, dayStart),
  ]);
  const duplicatesOnDay = Math.max(0, enquiriesOnDay - leadsOnDay);
  const duplicatesPrevDay = Math.max(0, enquiriesPrevDay - previousDay);

  const statuses = effectiveStatuses(settings?.statusOptions);
  const pipelineCounts = Object.fromEntries(statuses.map((s) => [s, 0]));
  const bucketCounts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const sourceCounts = {};
  const campaignCounts = {};
  const modelCounts = {};

  // Every calendar day from the 1st to the report date, zero-filled so quiet
  // days still show as gaps in the chart rather than vanishing.
  const trendMap = {};
  for (let d = monthStartStr; d <= dateStr; d = shiftDateStr(d, 1)) trendMap[d] = 0;

  // Same definitions as the Dashboard's Total / Unique / Duplicate cards:
  // a lead is one unique customer+model; duplicateCount is how many repeat
  // enquiries were folded into it; total enquiries = unique + duplicates.
  let duplicateEnquiries = 0;
  let totalCalls = 0;
  for (const lead of monthLeads) {
    duplicateEnquiries += lead.duplicateCount || 0;
    totalCalls += (lead.calls || []).length;
    const status = statuses.includes(lead.status) ? lead.status : statuses[0];
    pipelineCounts[status]++;
    const bucket = BUCKETS.includes(lead.bucket) ? lead.bucket : "unassigned";
    bucketCounts[bucket]++;
    const source = lead.source || "Meta Ads";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (lead.campaign) campaignCounts[lead.campaign] = (campaignCounts[lead.campaign] || 0) + 1;
    const model = lead.canonicalModel || lead.model || "Unknown";
    modelCounts[model] = (modelCounts[model] || 0) + 1;
    const key = dateStrInTz(lead.sheetCreatedAt, timeZone);
    if (key in trendMap) trendMap[key]++;
  }

  return {
    date: dateStr,
    monthStart: monthStartStr,
    timezone: timeZone,
    counts: {
      onDay: leadsOnDay,
      previousDay,
      duplicatesOnDay,
      duplicatesPrevDay,
      // Month-to-date (1st → report date) — what every card/chart shows.
      monthToDate: monthLeads.length,
      monthEnquiries: monthLeads.length + duplicateEnquiries,
      duplicateEnquiries,
      totalCalls,
      // All-time unique leads as of end of the report date — footnote only.
      total: allTimeUnique,
    },
    pipeline: statuses.map((label) => ({ label, count: pipelineCounts[label] })),
    buckets: BUCKETS.map((key) => ({ key, label: prettyBucket(key), count: bucketCounts[key] })),
    sources: consolidate(toSortedArray(sourceCounts)),
    campaigns: consolidate(toSortedArray(campaignCounts)),
    models: consolidate(toSortedArray(modelCounts)),
    trend: Object.entries(trendMap).map(([date, count]) => ({ date, count })),
  };
}

// ---- rendering ----------------------------------------------------------
// Email-client-safe HTML (tables + inline styles, no flex/grid/JS) styled to
// read like the Dashboard: the same card/panel chrome, the same series
// colors (lib/leadFields.js's statusChartColor/bucketChartColor and
// lib/chartPalette.js's categorical palette), the same panel order.

const INK = "#111827";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Blends a hex color toward white — stands in for the fill-opacity ramp the
// on-screen funnel uses, since many mail clients drop opacity/rgba.
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * (1 - amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function kpiCard(label, value, accent, caption) {
  return `
    <td style="padding:0 5px 10px 0;vertical-align:top;width:16.6%;">
      <div style="background:#fff;border:1px solid ${BORDER};border-top:3px solid ${accent};border-radius:14px;padding:14px 14px 12px;">
        <div style="font-size:10.5px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;white-space:nowrap;">${esc(label)}</div>
        <div style="font-size:28px;font-weight:800;color:${INK};line-height:1.05;">${esc(value)}</div>
        <div style="font-size:11px;font-weight:600;margin-top:6px;color:${MUTED};min-height:13px;">${caption || ""}</div>
      </div>
    </td>`;
}

function panel(title, body) {
  return `
    <div style="background:#fff;border:1px solid ${BORDER};border-radius:16px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:700;color:${INK};margin-bottom:12px;">${esc(title)}</div>
      ${body}
    </div>`;
}

function emptyState(text) {
  return `<div style="font-size:13px;color:${MUTED};padding:8px 0;">${esc(text)}</div>`;
}

// Horizontal ranked bars — the email counterpart of BarListChart /
// StatusPieChart / BucketPieChart. `rows` is [{label, count, color}].
function barList(rows, { showPercent = true, labelWidth = 120 } = {}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return emptyState("No data yet");
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:12.5px;color:${INK};">
      ${rows
        .map((r) => {
          const pct = total ? Math.round((r.count / total) * 1000) / 10 : 0;
          const width = Math.max(Math.round((r.count / max) * 100), r.count > 0 ? 2 : 0);
          return `
          <tr>
            <td style="padding:4px 8px 4px 0;white-space:nowrap;width:${labelWidth}px;overflow:hidden;text-overflow:ellipsis;">${esc(r.label)}</td>
            <td style="padding:4px 0;">
              <div style="background:#f1f3f8;border-radius:6px;height:12px;overflow:hidden;">
                <div style="width:${width}%;height:12px;background:${r.color};border-radius:6px;"></div>
              </div>
            </td>
            <td style="padding:4px 0 4px 10px;white-space:nowrap;text-align:right;font-weight:700;width:${showPercent ? 78 : 36}px;">${r.count}${
              showPercent ? `<span style="color:${MUTED};font-weight:500;"> · ${pct}%</span>` : ""
            }</td>
          </tr>`;
        })
        .join("")}
    </table>`;
}

// Vertical day-by-day bars built from table cells — the email counterpart
// of LeadsTrendChart. One column per calendar day of the month so far.
function trendChart(trend, accent) {
  const max = Math.max(...trend.map((t) => t.count), 1);
  if (trend.every((t) => t.count === 0)) return emptyState("No leads received this month yet");
  const H = 120;
  const bars = trend
    .map((t) => {
      const h = Math.round((t.count / max) * H);
      return `<td style="vertical-align:bottom;padding:0 1px;">
        <div style="font-size:9px;color:${MUTED};text-align:center;line-height:1;margin-bottom:2px;">${t.count || ""}</div>
        <div style="height:${Math.max(h, t.count ? 3 : 1)}px;background:${t.count ? accent : "#e5e8f0"};border-radius:3px 3px 0 0;"></div>
      </td>`;
    })
    .join("");
  const labels = trend
    .map((t, i) => {
      const day = Number(t.date.slice(8, 10));
      const show = trend.length <= 16 || i === 0 || i === trend.length - 1 || day % 5 === 0;
      return `<td style="font-size:9px;color:${MUTED};text-align:center;padding:4px 0 0;">${show ? day : ""}</td>`;
    })
    .join("");
  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">
      <tr style="height:${H + 14}px;">${bars}</tr>
      <tr style="border-top:1px solid ${BORDER};">${labels}</tr>
    </table>`;
}

function twoColumn(left, right) {
  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:7px;">${left}</td>
        <td style="vertical-align:top;width:50%;padding-left:7px;">${right}</td>
      </tr>
    </table>`;
}

function deltaCaption(today, yesterday) {
  if (!yesterday) return today > 0 ? `<span style="color:#1baf7a;">New today</span>` : "";
  const diff = today - yesterday;
  if (diff === 0) return `<span style="color:${MUTED};">Same as yesterday</span>`;
  const pct = Math.round((Math.abs(diff) / yesterday) * 100);
  return diff > 0
    ? `<span style="color:#1baf7a;">&#9650; ${pct}% vs yesterday</span>`
    : `<span style="color:#e5484d;">&#9660; ${pct}% vs yesterday</span>`;
}

function renderReportHtml(company, report) {
  const { counts } = report;
  const brand = company.brandColor || "#3d5afe";
  const rangeLabel = `${formatDateShort(report.monthStart)} – ${formatDateShort(report.date)}`;

  const statusRows = report.pipeline.filter((p) => p.count > 0).map((p) => ({ ...p, color: statusChartColor(p.label) }));
  const byLabel = Object.fromEntries(report.pipeline.map((p) => [p.label, p.count]));
  const funnelRows = FUNNEL_ORDER.map((label, i) => ({
    label,
    count: byLabel[label] || 0,
    color: tint(brand, 0.35 + (i / (FUNNEL_ORDER.length - 1)) * 0.65),
  }));
  const bucketRows = report.buckets.map((b) => ({ label: b.label, count: b.count, color: bucketChartColor(b.key) }));
  const sourceRows = report.sources.map((r, i) => ({ ...r, color: categoricalColor(i, r.label) }));
  const campaignRows = report.campaigns.map((r, i) => ({ ...r, color: categoricalColor(i, r.label) }));
  const modelRows = report.models.map((r, i) => ({ ...r, color: categoricalColor(i, r.label) }));

  return `<!doctype html>
<html><body style="margin:0;background:#eef0f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:760px;margin:0 auto;padding:20px 10px;">
    <div style="background:${esc(brand)};color:#fff;border-radius:16px;padding:20px 22px;margin-bottom:14px;">
      ${company.logoUrl ? `<img src="${esc(company.logoUrl)}" alt="" style="max-height:34px;max-width:150px;display:block;margin-bottom:10px;background:#fff;border-radius:6px;padding:4px;">` : ""}
      <div style="font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Monthly Dashboard Report · ${esc(formatMonthLabel(report.date))}</div>
      <div style="font-size:22px;font-weight:800;margin-top:2px;">${esc(company.name)}</div>
      <div style="font-size:13px;opacity:.92;margin-top:6px;">
        <span style="display:inline-block;background:rgba(255,255,255,.18);border-radius:999px;padding:3px 10px;">${esc(rangeLabel)} · month to date</span>
        &nbsp; Sent for ${esc(formatDateLong(report.date))}
      </div>
    </div>

    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:2px;"><tr>
      <td style="font-size:15px;font-weight:700;color:${INK};padding-bottom:10px;">Lead Pipeline · ${esc(formatMonthLabel(report.date))}</td>
      <td style="text-align:right;font-size:11.5px;color:${MUTED};padding-bottom:10px;">${esc(rangeLabel)}</td>
    </tr></table>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;"><tr>
      ${kpiCard("Total Leads", counts.monthEnquiries, brand, "enquiries this month")}
      ${kpiCard("Unique Leads", counts.monthToDate, "#2a78d6", "customers this month")}
      ${kpiCard("Duplicate Leads", counts.duplicateEnquiries, "#eda100", "repeat enquiries this month")}
      ${kpiCard("Today's Leads", counts.onDay, "#1baf7a", deltaCaption(counts.onDay, counts.previousDay))}
      ${kpiCard("Today's Duplicates", counts.duplicatesOnDay, "#b45309", "repeat enquiries today")}
      ${kpiCard("Yesterday's Leads", counts.previousDay, "#94a3b8", `${esc(formatDateShort(shiftDateStr(report.date, -1)))}${counts.duplicatesPrevDay ? ` · +${counts.duplicatesPrevDay} duplicates` : ""}`)}
    </tr></table>
    <div style="font-size:11.5px;color:${MUTED};margin:0 0 14px;">Every figure and chart in this report covers ${esc(rangeLabel)} — leads received from the 1st of the month up to and including the report date. All-time unique leads as of this date: <b style="color:${INK};">${counts.total}</b>.</div>

    ${twoColumn(panel("Lead Status Distribution", barList(statusRows)), panel("Pipeline Funnel", barList(funnelRows, { showPercent: false })))}
    ${twoColumn(panel("Lead Source Distribution", barList(sourceRows)), panel("Lead Bucket Distribution", barList(bucketRows)))}
    ${campaignRows.length ? panel("Leads by Campaign", barList(campaignRows, { labelWidth: 260 })) : ""}
    ${panel(`Leads per day · ${formatMonthLabel(report.date)}`, trendChart(report.trend, brand))}
    ${panel("Leads by Model", barList(modelRows, { labelWidth: 200 }))}

    <div style="text-align:center;color:#9ca3af;font-size:11px;margin-top:6px;">
      Automated report from the CRM · day boundaries in ${esc(report.timezone)}
    </div>
  </div>
</body></html>`;
}

function renderReportText(company, report) {
  const { counts } = report;
  const lines = [
    `${company.name} — Monthly Dashboard Report as of ${report.date}`,
    `Covers ${report.monthStart} to ${report.date} (month to date)`,
    ``,
    `Total leads (enquiries): ${counts.monthEnquiries}`,
    `Unique leads: ${counts.monthToDate}`,
    `Duplicate leads: ${counts.duplicateEnquiries}`,
    `Today's leads: ${counts.onDay}`,
    `Today's duplicates (repeat enquiries): ${counts.duplicatesOnDay}`,
    `Yesterday's leads: ${counts.previousDay}`,
    `All-time unique leads to date: ${counts.total}`,
    ``,
  ];
  for (const [title, rows] of [
    ["Lead status", report.pipeline],
    ["Lead source", report.sources],
    ["Lead bucket", report.buckets],
    ["Leads by model", report.models],
  ]) {
    const nonZero = rows.filter((r) => r.count > 0);
    if (!nonZero.length) continue;
    lines.push(`${title}:`);
    for (const r of nonZero) lines.push(`  ${r.label}: ${r.count}`);
    lines.push(``);
  }
  return lines.join("\n");
}

// ---- sending ------------------------------------------------------------

// Builds + emails one company's report for one date. `recipients` defaults
// to the company's configured list; a caller may override it (e.g. "send a
// test to just me"). Always writes an EmailReportLog row, success or not,
// and never throws for a delivery failure — the caller reads `status`.
async function sendDailyReport({ company, config, dateStr, trigger = "manual", recipients }) {
  const cfg = normalizeConfig(config);
  const to = (recipients || cfg.recipients).filter(isValidEmail);
  const logBase = { companyId: company._id, reportDate: dateStr, trigger, recipients: to };

  if (to.length === 0) {
    await EmailReportLog.create({ ...logBase, status: "skipped", errorMessage: "No recipients configured" });
    return { status: "skipped", error: "No recipients configured", recipients: to };
  }

  let report;
  try {
    report = await buildDailyReport(company._id, dateStr, cfg.timezone);
    await sendMail({
      to,
      subject: `${company.name} — ${formatMonthLabel(report.date)} report as of ${report.date}: ${report.counts.onDay} today, ${report.counts.monthToDate} this month`,
      html: renderReportHtml(company, report),
      text: renderReportText(company, report),
    });
  } catch (err) {
    console.error(`[email-reports] ${company.name} ${dateStr} failed:`, err);
    await EmailReportLog.create({
      ...logBase,
      status: "error",
      leadsOnDay: report?.counts.onDay || 0,
      totalLeads: report?.counts.total || 0,
      errorMessage: err.message,
    });
    return { status: "error", error: err.message, recipients: to };
  }

  await EmailReportLog.create({ ...logBase, status: "sent", leadsOnDay: report.counts.onDay, totalLeads: report.counts.total });
  return { status: "sent", recipients: to, leadsOnDay: report.counts.onDay, totalLeads: report.counts.total };
}

// Called by the cron route however often the host fires it (hourly is
// ideal; once a day still works as long as it lands at/after every
// company's sendHour). Idempotent per company per calendar day via
// Settings.emailReports.lastScheduledDate, which is only advanced after a
// successful send — a delivery failure is retried on the next tick.
async function runScheduledReports(now = new Date()) {
  const companies = await Company.find({ active: true }).lean();
  const allSettings = await Settings.find({ companyId: { $in: companies.map((c) => c._id) } })
    .select("companyId emailReports")
    .lean();
  const settingsByCompany = Object.fromEntries(allSettings.map((s) => [String(s.companyId), s]));

  const results = [];
  for (const company of companies) {
    const cfg = normalizeConfig(settingsByCompany[String(company._id)]?.emailReports);
    const entry = { companyId: String(company._id), companyName: company.name };

    if (!cfg.dailyEnabled) {
      results.push({ ...entry, status: "skipped", reason: "daily reports disabled" });
      continue;
    }
    if (cfg.recipients.length === 0) {
      results.push({ ...entry, status: "skipped", reason: "no recipients" });
      continue;
    }
    const today = dateStrInTz(now, cfg.timezone);
    if (cfg.lastScheduledDate === today) {
      results.push({ ...entry, status: "skipped", reason: "already sent today" });
      continue;
    }
    if (hourInTz(now, cfg.timezone) < cfg.sendHour) {
      results.push({ ...entry, status: "skipped", reason: `waiting for ${cfg.sendHour}:00 ${cfg.timezone}` });
      continue;
    }

    const reportDate = cfg.coverage === "today" ? today : shiftDateStr(today, -1);
    const result = await sendDailyReport({ company, config: cfg, dateStr: reportDate, trigger: "scheduled" });
    if (result.status === "sent") {
      await Settings.updateOne({ companyId: company._id }, { $set: { "emailReports.lastScheduledDate": today } });
    }
    results.push({ ...entry, reportDate, ...result });
  }
  return results;
}

module.exports = {
  DEFAULT_TIMEZONE,
  normalizeConfig,
  isValidEmail,
  isValidDateStr,
  isValidTimeZone,
  dateStrInTz,
  shiftDateStr,
  buildDailyReport,
  renderReportHtml,
  sendDailyReport,
  runScheduledReports,
};
