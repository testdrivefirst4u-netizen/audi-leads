import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

function formatHour(h) {
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

// Expandable row in the Companies panel (super admin) that manages one
// company's day-wise lead report emails: who receives them, the daily
// schedule, and an on-demand "send / preview for this date" — all backed by
// pages/api/companies/[id]/email-reports.js.
export default function EmailReportsRow({ company, onClose }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [mailConfigured, setMailConfigured] = useState(true);
  const [history, setHistory] = useState([]);
  const [today, setToday] = useState("");

  const [recipients, setRecipients] = useState([""]);
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [sendHour, setSendHour] = useState(9);
  const [coverage, setCoverage] = useState("yesterday");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [lastScheduledDate, setLastScheduledDate] = useState("");
  const [saving, setSaving] = useState(false);

  const [reportDate, setReportDate] = useState("");
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null); // { date, counts, html }
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/companies/${company._id}/email-reports`);
    if (!res.ok) {
      toast("Failed to load email report settings", { type: "err" });
      return;
    }
    const data = await res.json();
    const cfg = data.config || {};
    setRecipients(cfg.recipients?.length ? cfg.recipients : [""]);
    setDailyEnabled(Boolean(cfg.dailyEnabled));
    setSendHour(cfg.sendHour ?? 9);
    setCoverage(cfg.coverage || "yesterday");
    setTimezone(cfg.timezone || "Asia/Kolkata");
    setLastScheduledDate(cfg.lastScheduledDate || "");
    setMailConfigured(Boolean(data.mailConfigured));
    setHistory(data.history || []);
    setToday(data.today || "");
    // Default the manual picker to the most recently completed day — the
    // same day the morning schedule would report on.
    setReportDate((prev) => {
      if (prev) return prev;
      const d = new Date(`${data.today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    });
    setLoading(false);
  }, [company._id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function updateRecipient(i, value) {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? value : r)));
  }
  function removeRecipient(i) {
    setRecipients((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length ? next : [""];
    });
  }

  const cleanRecipients = recipients.map((r) => r.trim()).filter(Boolean);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}/email-reports`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: cleanRecipients, dailyEnabled, sendHour, coverage, timezone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setRecipients(data.config.recipients.length ? data.config.recipients : [""]);
      toast("Email report settings saved");
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await apiFetch(`/api/companies/${company._id}/email-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: reportDate, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to build preview");
      setPreview(data);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendReport(overrideRecipients) {
    const setBusy = overrideRecipients ? setSendingTest : setSending;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}/email-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: reportDate, ...(overrideRecipients ? { recipients: overrideRecipients } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send report");
      const r = data.result;
      toast(`Report for ${r.date} sent to ${r.recipients.length} recipient${r.recipients.length === 1 ? "" : "s"}`);
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setBusy(false);
    }
  }

  const savedRecipientsEmpty = cleanRecipients.length === 0;

  return (
    <tr>
      <td colSpan={7} className="whitespace-normal">
        <div className="whitespace-normal" style={{ padding: "16px 0" }}>
          <div className="hint mb-3">
            Month-to-date Dashboard report for <strong>{company.name}</strong>, sent daily — the same KPI cards and
            charts as the Dashboard (Total / Unique / Duplicate / Today / Yesterday, status, funnel, source, bucket,
            campaign, leads-per-day and model), with every figure covering the 1st of the month through the report
            date. No individual lead details are included, and only this company&apos;s data is ever used.
          </div>

          {!loading && !mailConfigured && (
            <div
              className="panel mb-4 whitespace-normal"
              style={{ padding: 12, background: "#fffbeb", borderColor: "#f59e0b" }}
            >
              <strong>Email isn&apos;t configured on the server yet.</strong>{" "}
              <span className="hint inline">
                Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and{" "}
                <code>SMTP_FROM</code> in the environment. Recipients and the schedule can be saved now; sending starts
                working once SMTP is set.
              </span>
            </div>
          )}

          {loading ? (
            <Skeleton count={4} height={30} />
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div>
                  <label className="block mb-1.5 text-sm font-semibold">Recipients</label>
                  <div className="hint mb-2">
                    Every address here receives this company&apos;s report. Add as many as you need.
                  </div>
                  {recipients.map((r, i) => (
                    <div className="flex gap-2 mb-2" key={i}>
                      <input
                        type="email"
                        value={r}
                        onChange={(e) => updateRecipient(i, e.target.value)}
                        placeholder="manager@company.com"
                        className="flex-1 min-w-0"
                      />
                      <button className="btn-sm" type="button" onClick={() => removeRecipient(i)}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <button className="btn-sm" type="button" onClick={() => setRecipients((prev) => [...prev, ""])}>
                    + Add Email
                  </button>
                </div>

                <div>
                  <label className="block mb-1.5 text-sm font-semibold">Automatic daily email</label>
                  <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer">
                    <input type="checkbox" checked={dailyEnabled} onChange={(e) => setDailyEnabled(e.target.checked)} />
                    Send this company&apos;s report automatically every day
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="field mb-0 min-w-0">
                      <label>Send at</label>
                      <select
                        value={sendHour}
                        onChange={(e) => setSendHour(Number(e.target.value))}
                        disabled={!dailyEnabled}
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>
                            {formatHour(h)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field mb-0 min-w-0">
                      <label>Report covers</label>
                      <select value={coverage} onChange={(e) => setCoverage(e.target.value)} disabled={!dailyEnabled}>
                        <option value="yesterday">Previous day (morning send)</option>
                        <option value="today">Same day (end-of-day send)</option>
                      </select>
                    </div>
                    <div className="field mb-0 min-w-0">
                      <label>Timezone</label>
                      <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                        {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="hint mt-2">
                    {dailyEnabled
                      ? `Goes out once a day at or shortly after ${formatHour(sendHour)} (${timezone}), covering ${
                          coverage === "today" ? "that same day's" : "the previous day's"
                        } leads.`
                      : "Automatic sending is off — reports can still be sent manually below."}
                    {lastScheduledDate && ` Last automatic send: ${lastScheduledDate}.`}
                    {dailyEnabled && sendHour > 9 && (
                      <span className="block mt-1 text-[#b45309]">
                        Note: on the current hosting plan the scheduler runs once a day at 9:00 AM (Asia/Kolkata). Pick 9:00 AM
                        or earlier for the report to go out that day.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-4 mb-6">
                <button className="btn" type="button" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </button>
                <button className="btn-sm" type="button" onClick={onClose}>
                  Close
                </button>
              </div>

              <div className="panel mb-4 whitespace-normal" style={{ padding: 16 }}>
                <label className="block mb-1.5 text-sm font-semibold">Generate report for a specific date</label>
                <div className="hint mb-3">
                  Preview the email, send it to the saved recipients, or send a test copy to a single address. Uses the
                  recipients as currently saved — save above first if you just changed them.
                </div>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div className="field mb-0" style={{ width: 180, maxWidth: "100%" }}>
                    <label>Report date</label>
                    <input type="date" value={reportDate} max={today} onChange={(e) => setReportDate(e.target.value)} />
                  </div>
                  <button className="btn-sm" type="button" onClick={handlePreview} disabled={previewing || !reportDate}>
                    {previewing ? "Building..." : "Preview"}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => sendReport()}
                    disabled={sending || !reportDate || !mailConfigured}
                    title={!mailConfigured ? "SMTP is not configured" : undefined}
                  >
                    {sending ? "Sending..." : "Send to Recipients"}
                  </button>
                </div>
                <div className="field mb-0" style={{ maxWidth: 480 }}>
                  <label>Send a test copy to</label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="flex-1"
                      style={{ minWidth: 200 }}
                    />
                    <button
                      className="btn-sm"
                      type="button"
                      onClick={() => sendReport([testEmail])}
                      disabled={sendingTest || !reportDate || !testEmail.trim() || !mailConfigured}
                    >
                      {sendingTest ? "Sending..." : "Send Test"}
                    </button>
                  </div>
                </div>

                {preview && (
                  <div className="mt-4">
                    <div className="hint mb-2">
                      Preview for <strong>{preview.date}</strong>: {preview.counts.onDay} lead
                      {preview.counts.onDay === 1 ? "" : "s"} received, {preview.counts.monthToDate} this month,{" "}
                      {preview.counts.total} total to date.
                    </div>
                    <iframe
                      title="Report preview"
                      srcDoc={preview.html}
                      sandbox=""
                      style={{
                        width: "100%",
                        height: 560,
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        background: "#eef0f4",
                      }}
                    />
                  </div>
                )}
              </div>

              <label className="block mb-1.5 text-sm font-semibold">Recent sends</label>
              {history.length === 0 ? (
                <div className="hint">
                  No reports sent yet{savedRecipientsEmpty ? " — add at least one recipient above" : ""}.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Sent</th>
                        <th>Report date</th>
                        <th>Trigger</th>
                        <th>Recipients</th>
                        <th>Leads</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h._id}>
                          <td className="text-muted" style={{ whiteSpace: "nowrap" }}>
                            {new Date(h.createdAt).toLocaleString()}
                          </td>
                          <td>{h.reportDate}</td>
                          <td className="text-muted">{h.trigger === "scheduled" ? "Automatic" : "Manual"}</td>
                          <td className="text-muted" style={{ maxWidth: 320, wordBreak: "break-all" }}>
                            {h.recipients.join(", ") || "—"}
                          </td>
                          <td>
                            {h.leadsOnDay} <span className="text-muted">/ {h.totalLeads} total</span>
                          </td>
                          <td>
                            <span
                              className={`pill ${
                                h.status === "sent"
                                  ? "bg-success/10 text-success"
                                  : h.status === "error"
                                    ? "bg-danger/10 text-danger"
                                    : "bg-accent-soft text-accent"
                              }`}
                              title={h.errorMessage || undefined}
                            >
                              {h.status === "sent" ? "Sent" : h.status === "error" ? "Failed" : "Skipped"}
                            </span>
                            {h.errorMessage && <div className="hint mt-1">{h.errorMessage}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
