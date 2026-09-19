import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import { WhatsAppIcon } from "./icons";

// New-campaign wizard: channel → audience (live count) → template → send /
// schedule. Creates a draft, then either sends immediately (the report page
// takes over and drives batches) or schedules it for the cron.

function qs(companyId, extra = {}) {
  const p = new URLSearchParams();
  if (companyId) p.set("companyId", companyId);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const DEFAULT_AUDIENCE = { model: "", status: "", source: "", platform: "", location: "", agent: "", bucket: "", from: "", to: "", search: "", excludeMessagedDays: 7, excludeStatuses: [] };

function StepDots({ step }) {
  const labels = ["Channel", "Audience", "Message", "Send"];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${i < step ? "bg-success text-white" : i === step ? "bg-accent text-white" : "bg-bg text-muted"}`}>
            {i < step ? "✓" : i + 1}
          </span>
          <span className={`text-[12.5px] font-semibold ${i === step ? "text-ink" : "text-muted"}`}>{l}</span>
          {i < labels.length - 1 && <span className="h-px w-5 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function localDateTimeValue(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CampaignWizard({ companyId = "", onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState("");
  const [name, setName] = useState("");
  const [options, setOptions] = useState(null);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState("now");
  const [scheduledAt, setScheduledAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch(`/api/messaging/options${qs(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOptions(d));
  }, [companyId]);

  useEffect(() => {
    if (!channel) return;
    apiFetch(`/api/messaging/templates${qs(companyId, { channel })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.templates || []).filter((t) => channel !== "whatsapp" || !t.waStatus || t.waStatus === "APPROVED");
        setTemplates(list);
        if (list.length && !list.find((t) => t._id === templateId)) setTemplateId(list[0]._id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, companyId]);

  // Live audience count, debounced.
  useEffect(() => {
    if (!channel || step < 1) return;
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const res = await apiFetch(`/api/messaging/campaigns${qs(companyId, { preview: "1" })}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, audience }),
      });
      if (cancelled) return;
      if (res.ok) setPreview((await res.json()).preview);
      setPreviewing(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [channel, audience, step, companyId]);

  const template = useMemo(() => templates.find((t) => t._id === templateId), [templates, templateId]);

  function set(k, v) {
    setAudience((a) => ({ ...a, [k]: v }));
  }

  async function launch() {
    if (!name.trim()) return toast("Give the campaign a name", { type: "err" });
    if (!templateId) return toast("Pick a template", { type: "err" });
    setBusy(true);
    try {
      const res = await apiFetch(`/api/messaging/campaigns${qs(companyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, channel, templateId, audience }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast(d.error || "Could not create campaign", { type: "err" });
      const id = d.campaign._id;
      if (mode === "draft") {
        toast("Draft saved", { type: "ok" });
        return onDone?.(id, "draft");
      }
      const action = mode === "now" ? "send" : "schedule";
      const r2 = await apiFetch(`/api/messaging/campaigns/${id}${qs(companyId, { action })}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "schedule" ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        toast(d2.error || "Campaign saved as draft but could not start", { type: "err" });
        return onDone?.(id, "draft");
      }
      toast(mode === "now" ? `Sending to ${d2.queued ?? preview?.eligible ?? ""} customers` : "Campaign scheduled", { type: "ok" });
      onDone?.(id, mode);
    } finally {
      setBusy(false);
    }
  }

  const canNext = step === 0 ? Boolean(channel && name.trim()) : step === 1 ? Boolean(preview && preview.eligible > 0) : step === 2 ? Boolean(templateId) : true;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-[820px]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>New campaign</h2>
            <div className="mt-2">
              <StepDots step={step} />
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {step === 0 && (
            <div>
              <div className="field">
                <label>Campaign name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Festive offer — Q5 enquiries" autoFocus />
              </div>
              <div className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Channel</div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                {[
                  { key: "whatsapp", title: "WhatsApp", desc: `Approved Meta templates from this company's number. ${options ? `${options.counts.withPhone} leads have a phone.` : ""}`, icon: <WhatsAppIcon />, cls: "bg-[#e7f9ee] text-[#128c7e]" },
                  {
                    key: "email",
                    title: "Email",
                    desc: `Branded email from this company's sender. ${options ? `${options.counts.withEmail} leads have an email.` : ""}`,
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="M3 7l9 6 9-6" />
                      </svg>
                    ),
                    cls: "bg-[#eef3ff] text-[#1d4ed8]",
                  },
                ].map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setChannel(c.key)}
                    className={`text-left rounded-2xl border p-4 transition-all cursor-pointer bg-card ${channel === c.key ? "border-accent shadow-[0_0_0_3px_rgba(var(--accent-rgb),0.15)]" : "border-border hover:border-accent/50"}`}
                  >
                    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${c.cls}`}>{c.icon}</span>
                    <div className="font-bold text-ink mt-2.5">{c.title}</div>
                    <div className="hint m-0 mt-1">{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(220px, 1fr)" }}>
              <div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
                  {[
                    ["model", "Model", options?.models],
                    ["status", "Status", options?.statuses],
                    ["source", "Source", options?.sources],
                    ["location", "Showroom", options?.locations],
                    ["platform", "Platform", options?.platforms],
                    ["bucket", "Bucket", options?.buckets],
                  ].map(([k, label, list]) =>
                    list && list.length ? (
                      <div key={k} className="field mb-0">
                        <label>{label}</label>
                        <select value={audience[k]} onChange={(e) => set(k, e.target.value)}>
                          <option value="">Any</option>
                          {list.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null
                  )}
                  {options?.agents?.length > 0 && (
                    <div className="field mb-0">
                      <label>Agent</label>
                      <select value={audience.agent} onChange={(e) => set("agent", e.target.value)}>
                        <option value="">Any</option>
                        <option value="unassigned">Unassigned</option>
                        {options.agents.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="field mb-0">
                    <label>Enquired from</label>
                    <input type="date" value={audience.from} onChange={(e) => set("from", e.target.value)} />
                  </div>
                  <div className="field mb-0">
                    <label>Enquired to</label>
                    <input type="date" value={audience.to} onChange={(e) => set("to", e.target.value)} />
                  </div>
                  <div className="field mb-0">
                    <label>Skip if messaged in last</label>
                    <select value={audience.excludeMessagedDays} onChange={(e) => set("excludeMessagedDays", Number(e.target.value))}>
                      {[0, 3, 7, 14, 30].map((d) => (
                        <option key={d} value={d}>
                          {d === 0 ? "Don't skip" : `${d} days`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field mt-3 mb-0">
                  <label>Name / phone / email contains</label>
                  <input value={audience.search} onChange={(e) => set("search", e.target.value)} placeholder="optional" />
                </div>
                {options?.statuses?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[12px] font-bold uppercase tracking-wide text-muted mb-1.5">Exclude statuses</div>
                    <div className="flex flex-wrap gap-1.5">
                      {options.statuses.map((s) => {
                        const on = audience.excludeStatuses.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`pill cursor-pointer border ${on ? "bg-danger/10 text-danger border-danger/30" : "bg-card text-muted border-border"}`}
                            onClick={() => set("excludeStatuses", on ? audience.excludeStatuses.filter((x) => x !== s) : [...audience.excludeStatuses, s])}
                          >
                            {on ? "✕ " : ""}
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-2xl bg-bg p-4 self-start">
                <div className="text-[12px] font-bold uppercase tracking-wide text-muted">Audience</div>
                <div className="text-[34px] font-bold text-ink leading-tight mt-1">{previewing || !preview ? "…" : preview.eligible.toLocaleString()}</div>
                <div className="hint m-0">
                  {preview ? `${preview.matched.toLocaleString()} match the filters · ${preview.excluded.toLocaleString()} excluded (no ${channel === "whatsapp" ? "phone" : "email"}, opted out, or messaged recently)` : "Counting…"}
                </div>
                {preview?.sample?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1">Sample</div>
                    {preview.sample.map((l) => (
                      <div key={l._id} className="text-[12.5px] text-ink truncate">
                        {l.name || "—"} <span className="text-muted">· {channel === "whatsapp" ? l.phone : l.email} · {l.canonicalModel || ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              {templates.length === 0 ? (
                <div className="empty-state">
                  No {channel === "whatsapp" ? "approved WhatsApp" : "email"} templates for this company yet. Add one on the Templates tab{channel === "whatsapp" ? " (Sync from Meta)" : ""}, then come back.
                </div>
              ) : (
                <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(200px, 1fr) minmax(0, 1.4fr)" }}>
                  <div className="flex flex-col gap-2">
                    {templates.map((t) => (
                      <button
                        key={t._id}
                        type="button"
                        onClick={() => setTemplateId(t._id)}
                        className={`text-left rounded-xl border px-3.5 py-3 cursor-pointer bg-card ${templateId === t._id ? "border-accent shadow-[0_0_0_3px_rgba(var(--accent-rgb),0.15)]" : "border-border hover:border-accent/50"}`}
                      >
                        <div className="font-semibold text-ink text-[13.5px]">{t.name}</div>
                        <div className="hint m-0 truncate">{t.channel === "whatsapp" ? t.waName : t.subjectPreview}</div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-wide text-muted mb-1.5">Preview (sample customer)</div>
                    {template ? (
                      channel === "whatsapp" ? (
                        <div className="rounded-2xl p-4" style={{ background: "#e5ddd5" }}>
                          <div className="rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink whitespace-pre-wrap shadow-sm max-w-[360px]" style={{ lineHeight: 1.45 }}>
                            {template.preview}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border overflow-hidden">
                          <div className="px-4 py-2.5 border-b border-border bg-bg text-[13px]">
                            <span className="text-muted">Subject:</span> <span className="font-semibold text-ink">{template.subjectPreview}</span>
                          </div>
                          <div className="px-4 py-3 text-[13.5px] text-ink whitespace-pre-wrap" style={{ lineHeight: 1.5 }}>
                            {template.preview}
                          </div>
                        </div>
                      )
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="rounded-2xl bg-bg p-4 mb-4">
                <div className="font-bold text-ink">{name}</div>
                <div className="hint m-0 mt-0.5">
                  {channel === "whatsapp" ? "WhatsApp" : "Email"} · template <b>{template?.name}</b> · <b>{preview?.eligible?.toLocaleString()}</b> customers
                </div>
              </div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                {[
                  ["now", "Send now", "Starts immediately. Keep the report open — it sends in batches and respects quiet hours."],
                  ["schedule", "Schedule", "Runs automatically at the chosen time."],
                  ["draft", "Save as draft", "Review and send later from the Campaigns list."],
                ].map(([k, title, desc]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMode(k)}
                    className={`text-left rounded-xl border p-3.5 cursor-pointer bg-card ${mode === k ? "border-accent shadow-[0_0_0_3px_rgba(var(--accent-rgb),0.15)]" : "border-border hover:border-accent/50"}`}
                  >
                    <div className="font-bold text-ink text-[13.5px]">{title}</div>
                    <div className="hint m-0 mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>
              {mode === "schedule" && (
                <div className="field mt-3 mb-0" style={{ maxWidth: 280 }}>
                  <label>Send at</label>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <button className="btn-sm" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} disabled={busy}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button className="btn-sm btn-export" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn-sm btn-export" disabled={busy} onClick={launch}>
              {busy ? "Working…" : mode === "now" ? "Send campaign" : mode === "schedule" ? "Schedule campaign" : "Save draft"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
