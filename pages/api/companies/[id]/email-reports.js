const connectDB = require("../../../../lib/db");
const Company = require("../../../../models/Company");
const Settings = require("../../../../models/Settings");
const EmailReportLog = require("../../../../models/EmailReportLog");
const { requireSuperAdmin } = require("../../../../lib/auth");
const { isMailConfigured } = require("../../../../lib/mailer");
const {
  normalizeConfig,
  isValidEmail,
  isValidDateStr,
  isValidTimeZone,
  dateStrInTz,
  shiftDateStr,
  buildDailyReport,
  renderReportHtml,
  sendDailyReport,
} = require("../../../../lib/emailReports");

const HISTORY_LIMIT = 15;

function cleanEmails(input) {
  return [...new Set(input.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean))];
}

// Super-admin management of one company's day-wise report emails:
//   GET   → current config + recent send history (+ whether SMTP is set up)
//   PATCH → update recipients / schedule
//   POST  → { date, preview?, recipients? } — render (preview) or send the
//           report for a specific date on demand, independent of the schedule
async function handler(req, res) {
  await connectDB();
  const { id } = req.query;
  const company = await Company.findById(id).lean();
  if (!company) return res.status(404).json({ error: "Company not found" });

  if (req.method === "GET") {
    const settings = await Settings.findOne({ companyId: id }).select("emailReports").lean();
    const history = await EmailReportLog.find({ companyId: id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
    const config = normalizeConfig(settings?.emailReports);
    return res.status(200).json({
      config,
      mailConfigured: isMailConfigured(),
      today: dateStrInTz(new Date(), config.timezone),
      history: history.map((h) => ({
        _id: h._id,
        reportDate: h.reportDate,
        trigger: h.trigger,
        recipients: h.recipients,
        status: h.status,
        leadsOnDay: h.leadsOnDay,
        totalLeads: h.totalLeads,
        errorMessage: h.errorMessage || "",
        createdAt: h.createdAt,
      })),
    });
  }

  if (req.method === "PATCH") {
    const { recipients, dailyEnabled, sendHour, coverage, timezone } = req.body || {};
    const update = {};

    if (recipients !== undefined) {
      if (!Array.isArray(recipients)) return res.status(400).json({ error: "recipients must be an array" });
      const cleaned = cleanEmails(recipients);
      const invalid = cleaned.filter((r) => !isValidEmail(r));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid email address${invalid.length > 1 ? "es" : ""}: ${invalid.join(", ")}` });
      }
      update["emailReports.recipients"] = cleaned;
    }
    if (dailyEnabled !== undefined) update["emailReports.dailyEnabled"] = Boolean(dailyEnabled);
    if (sendHour !== undefined) {
      const h = Number(sendHour);
      if (!Number.isInteger(h) || h < 0 || h > 23) return res.status(400).json({ error: "sendHour must be 0-23" });
      update["emailReports.sendHour"] = h;
    }
    if (coverage !== undefined) {
      if (!["yesterday", "today"].includes(coverage)) {
        return res.status(400).json({ error: "coverage must be 'yesterday' or 'today'" });
      }
      update["emailReports.coverage"] = coverage;
    }
    if (timezone !== undefined) {
      if (!isValidTimeZone(String(timezone))) return res.status(400).json({ error: "Unknown timezone" });
      update["emailReports.timezone"] = String(timezone);
    }

    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Nothing to update" });
    const settings = await Settings.findOneAndUpdate({ companyId: id }, { $set: update }, { new: true, upsert: true });
    return res.status(200).json({ config: normalizeConfig(settings.emailReports) });
  }

  if (req.method === "POST") {
    const { date, preview, recipients } = req.body || {};
    const settings = await Settings.findOne({ companyId: id }).select("emailReports").lean();
    const config = normalizeConfig(settings?.emailReports);
    const today = dateStrInTz(new Date(), config.timezone);
    const dateStr = date || shiftDateStr(today, -1);
    if (!isValidDateStr(dateStr)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    if (dateStr > today) return res.status(400).json({ error: "Cannot generate a report for a future date" });

    if (preview) {
      const report = await buildDailyReport(company._id, dateStr, config.timezone);
      return res.status(200).json({ date: dateStr, counts: report.counts, html: renderReportHtml(company, report) });
    }

    let overrideRecipients;
    if (recipients !== undefined) {
      if (!Array.isArray(recipients)) return res.status(400).json({ error: "recipients must be an array" });
      overrideRecipients = cleanEmails(recipients);
      const invalid = overrideRecipients.filter((r) => !isValidEmail(r));
      if (invalid.length > 0) return res.status(400).json({ error: `Invalid email address: ${invalid.join(", ")}` });
    }
    if (!isMailConfigured()) {
      return res.status(400).json({ error: "Email is not configured on the server (SMTP_HOST / SMTP_FROM)." });
    }

    const result = await sendDailyReport({ company, config, dateStr, trigger: "manual", recipients: overrideRecipients });
    if (result.status !== "sent") {
      return res.status(result.status === "skipped" ? 400 : 502).json({ error: result.error, result });
    }
    return res.status(200).json({ result: { ...result, date: dateStr } });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdmin(handler);
