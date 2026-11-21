import { useCallback, useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";
import Link from "next/link";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

// Meta Conversions API settings, under the Lead Ads connection on the Meta
// integration page. When a lead from a Meta lead form reaches one of the
// chosen stages, the CRM tells the company's dataset (lib/meta/capi.js), so
// Ads Manager can optimise for leads that convert.
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");

function Pill({ tone, children }) {
  const cls = { ok: "bg-success/10 text-success", warn: "bg-[#eda100]/15 text-[#a16b00]", bad: "bg-danger/10 text-danger", off: "bg-bg text-muted" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${cls}`}>{children}</span>;
}

export default function CapiPanel({ companyId }) {
  const toast = useToast();
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ datasetId: "", accessToken: "", stages: [], testEventCode: "" });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/meta/capi${qs}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Couldn't load the Conversions API settings");
    setData(d);
    setForm((f) => ({ ...f, datasetId: d.config.datasetId, stages: d.config.stages, testEventCode: d.config.testEventCode, accessToken: "" }));
  }, [qs]);

  useEffect(() => {
    load().catch((err) => toast(err.message, { type: "err" }));
  }, [load, toast]);

  async function call(kind, method, body) {
    setBusy(kind);
    try {
      const res = await apiFetch(`/api/meta/capi${qs}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Something went wrong");
      return d;
    } catch (err) {
      toast(err.message, { type: "err" });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function save(extra = {}) {
    const body = { datasetId: form.datasetId, stages: form.stages, testEventCode: form.testEventCode, ...extra };
    if (form.accessToken.trim()) body.accessToken = form.accessToken.trim();
    const d = await call("save", "PATCH", body);
    if (d) {
      toast(d.warning || (extra.enabled === true ? "Conversions API is on" : extra.enabled === false ? "Conversions API is off" : "Saved"));
      await load();
    }
  }

  async function test() {
    const d = await call("test", "POST", { action: "test", testEventCode: form.testEventCode });
    if (!d) return;
    if (d.ok && d.note) toast(`Meta received the test event but says: ${d.note}`, { type: "err" });
    else if (d.ok) toast(`Test event "${d.eventName}" sent for ${d.leadName || "a Meta lead"}. In Events Manager → Test events, choose the CRM / system generated action source to see it.`);
    else toast(`Meta refused the test event: ${d.error}`, { type: "err" });
    load();
  }

  async function backfill() {
    const d = await call("backfill", "POST", { action: "backfill" });
    if (!d) return;
    if (d.error) toast(d.error, { type: "err" });
    else toast(`Last 7 days: ${d.sent} sent, ${d.skipped} already sent or not from Meta${d.failed ? `, ${d.failed} failed` : ""}.`, { type: d.failed ? "err" : undefined });
    load();
  }

  async function retry() {
    const d = await call("retry", "POST", { action: "retry" });
    if (d) toast(`${d.sent} resent${d.failed ? `, ${d.failed} still failing` : ""}.`, { type: d.failed ? "err" : undefined });
    load();
  }

  if (!data) {
    return (
      <div className="panel mb-6 p-5">
        <Skeleton count={5} height={28} className="mb-2" />
      </div>
    );
  }

  const { config, statuses, counts, events } = data;
  const ready = Boolean(config.datasetId && config.hasToken);
  const toggleStage = (s) => setForm((f) => ({ ...f, stages: f.stages.includes(s) ? f.stages.filter((x) => x !== s) : [...f.stages, s] }));

  return (
    <div className="panel mb-6">
      <div className="panel-header flex items-center justify-between gap-3">
        <h2>Conversions API (CAPI)</h2>
        {config.enabled ? config.testEventCode ? <Pill tone="warn">On · test mode</Pill> : <Pill tone="ok">On</Pill> : <Pill tone="off">Off</Pill>}
      </div>
      <div className="p-5">
        <p className="hint mt-0 mb-4">
          When a lead from a Meta lead form reaches a stage below, the CRM tells Meta. Then in Ads Manager you can set lead campaigns to optimise for{" "}
          <strong>conversion leads</strong>, so Meta looks for people who qualify and book, not just fill the form. Each lead is sent once per stage.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="field mb-0">
            <label>Dataset ID</label>
            <input inputMode="numeric" value={form.datasetId} onChange={(e) => setForm({ ...form, datasetId: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 1234567890123456" />
            <div className="hint mt-1">
              Events Manager → Data sources → your dataset. {config.datasetName && <>Connected: <strong>{config.datasetName}</strong></>}
            </div>
          </div>
          <div className="field mb-0">
            <label>Access token</label>
            <input
              type="password"
              autoComplete="off"
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              placeholder={config.hasToken ? `Saved (${config.tokenPreview}). Paste a new one to replace it` : "Paste the Conversions API token"}
            />
            <div className="hint mt-1">Dataset → Settings → Conversions API → Generate access token. Stored encrypted; never shown again.</div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-sm font-semibold mb-1.5">Send these stages to Meta</div>
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
                <label key={s} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] cursor-pointer ${form.stages.includes(s) ? "border-accent bg-accent/5" : "border-border"}`}>
                  <input type="checkbox" checked={form.stages.includes(s)} onChange={() => toggleStage(s)} />
                  {s === "New" ? "New lead (sent as “Lead”)" : s}
                </label>
            ))}
          </div>
          <div className="hint mt-1.5">Meta needs the first stage (New lead) plus the steps towards a sale: Qualified, Test Drive, Booking, Retail. In Ads Manager pick the one to optimise for.</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 items-end">
          <div className="field mb-0">
            <label>
              Test event code <span className="text-muted font-normal">(optional)</span>
            </label>
            <input value={form.testEventCode} onChange={(e) => setForm({ ...form, testEventCode: e.target.value.trim() })} placeholder="TEST12345" />
            <div className="hint mt-1">From Events Manager → Test events. While it&apos;s saved, every event goes to Test events only; clear it to go live.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-sm" onClick={() => save()} disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-sm" onClick={test} disabled={!!busy || !ready || !form.testEventCode} title={!form.testEventCode ? "Enter a test event code first" : ""}>
              {busy === "test" ? "Sending…" : "Send test event"}
            </button>
            {config.enabled ? (
              <button type="button" className="btn-sm" onClick={() => save({ enabled: false })} disabled={!!busy}>
                Turn off
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => save({ enabled: true })} disabled={!!busy || !(form.datasetId && (config.hasToken || form.accessToken))}>
                Turn on
              </button>
            )}
          </div>
        </div>

        <div className="dash-stat-grid">
          <div className="dash-card" style={{ "--dash-accent": "#1baf7a" }}>
            <div className="label">Sent, last 7 days</div>
            <div className="value text-[18px]">{counts.sentWeek}</div>
            <div className="dash-card-caption">Last sent: {fmt(config.lastSentAt)}</div>
          </div>
          <div className="dash-card" style={{ "--dash-accent": counts.failed ? "#e5484d" : "#94a3b8" }}>
            <div className="label">Failed, waiting to retry</div>
            <div className="value text-[18px]">{counts.failed}</div>
            <div className="dash-card-caption">
              {counts.failed ? (
                <button type="button" className="text-accent font-semibold bg-transparent border-0 p-0 cursor-pointer" onClick={retry} disabled={!!busy}>
                  Retry now
                </button>
              ) : (
                "Retried automatically by the daily sync"
              )}
            </div>
          </div>
          <div className="dash-card" style={{ "--dash-accent": "#2a78d6" }}>
            <div className="label">Leads from Meta forms</div>
            <div className="value text-[18px]">{counts.metaLeads}</div>
            <div className="dash-card-caption">Only these can be sent (they carry Meta&apos;s lead ID)</div>
          </div>
          <div className="dash-card" style={{ "--dash-accent": config.lastError ? "#e5484d" : "#94a3b8" }}>
            <div className="label">Last error</div>
            <div className="value text-[14px] whitespace-normal" style={{ lineHeight: 1.3 }}>
              {config.lastError || "None"}
            </div>
            {config.lastErrorAt && <div className="dash-card-caption">{fmt(config.lastErrorAt)}</div>}
          </div>
        </div>

        {config.enabled && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-bg p-3 text-[13px]">
            <span className="flex-1 min-w-[220px]">Just switched on? Send the stage changes of the last 7 days (Meta doesn&apos;t accept older ones).</span>
            <button type="button" className="btn-sm" onClick={backfill} disabled={!!busy}>
              {busy === "backfill" ? "Sending…" : "Send last 7 days"}
            </button>
          </div>
        )}

        <h3 className="mt-6 mb-2 text-[14px] font-bold">Recent events</h3>
        {events.length === 0 ? (
          <p className="hint m-0">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Lead", "Event", "Dataset", "Reached stage", "Result", ""].map((h) => (
                    <th key={h} className="py-2 pr-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-border/70">
                    <td className="py-2 pr-3">
                      <Link href={`/leads?open=${e.leadId}`} className="text-ink no-underline hover:underline">
                        {e.leadName || "(no name)"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{e.eventName}</td>
                    <td className={`py-2 pr-3 tabular-nums ${e.datasetId && e.datasetId !== config.datasetId ? "text-muted" : ""}`}>{e.datasetId || "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(e.eventTime)}</td>
                    <td className="py-2 pr-3">{e.state === "sent" ? <Pill tone="ok">Sent</Pill> : <Pill tone="bad">Failed ×{e.attempts}</Pill>}</td>
                    <td className="py-2 text-muted max-w-[360px]">{e.lastError}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
