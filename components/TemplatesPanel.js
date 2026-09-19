import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

// Message templates: email templates are written here; WhatsApp templates
// are approved by Meta and pulled in with "Sync from Meta", after which the
// admin maps each {{n}} placeholder to a lead variable.

function qs(companyId, extra = {}) {
  const p = new URLSearchParams();
  if (companyId) p.set("companyId", companyId);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const WA_STATUS_CLS = {
  APPROVED: "bg-[#ecfdf5] text-[#047857]",
  PENDING: "bg-[#fff7ed] text-[#c2410c]",
  REJECTED: "bg-[#fef2f2] text-[#b91c1c]",
  PAUSED: "bg-[#fef2f2] text-[#b91c1c]",
  DISABLED: "bg-bg text-muted",
};

const EMPTY = { channel: "email", name: "", subject: "", body: "", waName: "", waLanguage: "en", waBodyParams: [], waHeaderParam: "" };

export default function TemplatesPanel({ companyId = "", channel: onlyChannel = "", onChanged }) {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [variables, setVariables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(null); // template object or EMPTY copy
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(onlyChannel || "email");
  const [testing, setTesting] = useState(null); // template being test-sent
  const [testTo, setTestTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  function openTest(t) {
    let remembered = "";
    try {
      remembered = localStorage.getItem(`msg-test-to-${t.channel}`) || "";
    } catch {}
    setTestTo(remembered);
    setTesting(t);
  }

  async function sendTest() {
    if (!testTo.trim()) return toast(testing.channel === "whatsapp" ? "Enter your WhatsApp number" : "Enter your email", { type: "err" });
    setSendingTest(true);
    try {
      const res = await apiFetch(`/api/messaging/templates${qs(companyId, { action: "test", id: testing._id })}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast(d.error || "Test send failed", { type: "err" });
      try {
        localStorage.setItem(`msg-test-to-${testing.channel}`, testTo.trim());
      } catch {}
      toast(`Test sent to ${d.to}`, { type: "ok" });
      setTesting(null);
    } finally {
      setSendingTest(false);
    }
  }

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/messaging/templates${qs(companyId)}`);
    if (res.ok) {
      const d = await res.json();
      setTemplates(d.templates || []);
      setVariables(d.variables || []);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    const res = await apiFetch(`/api/messaging/templates${qs(companyId, { action: "sync" })}`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) return toast(d.error || "Sync failed", { type: "err" });
    toast(`Synced ${d.total} WhatsApp template${d.total === 1 ? "" : "s"} (${d.created} new, ${d.updated} updated)`, { type: "ok" });
    load();
    onChanged?.();
  }

  async function save() {
    setSaving(true);
    const isNew = !editing._id;
    const res = await apiFetch(`/api/messaging/templates${qs(companyId, isNew ? {} : { id: editing._id })}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast(d.error || "Could not save template", { type: "err" });
    toast("Template saved", { type: "ok" });
    setEditing(null);
    load();
    onChanged?.();
  }

  async function archive(t) {
    if (!window.confirm(`Archive template "${t.name}"?`)) return;
    const res = await apiFetch(`/api/messaging/templates${qs(companyId, { id: t._id })}`, { method: "DELETE" });
    if (res.ok) {
      toast("Template archived", { type: "ok" });
      load();
      onChanged?.();
    }
  }

  const visible = templates.filter((t) => t.channel === tab);
  const placeholders = editing ? [...new Set([...String(editing.body || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        {!onlyChannel ? (
          <div className="report-type-tabs">
            {["email", "whatsapp"].map((c) => (
              <button key={c} className={`report-type-tab ${tab === c ? "active" : ""}`} onClick={() => setTab(c)}>
                {c === "email" ? "Email" : "WhatsApp"} ({templates.filter((t) => t.channel === c).length})
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          {tab === "whatsapp" && (
            <button className="btn-sm" disabled={syncing} onClick={sync}>
              {syncing ? "Syncing…" : "Sync from Meta"}
            </button>
          )}
          <button className="btn-sm btn-export" onClick={() => setEditing({ ...EMPTY, channel: tab })}>
            + New {tab === "email" ? "email" : "WhatsApp"} template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="hint">Loading templates…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {tab === "whatsapp"
            ? "No WhatsApp templates yet. Create them in Meta WhatsApp Manager (Marketing category), wait for approval, then click Sync from Meta."
            : "No email templates yet. Create one — use {{name}}, {{model}}, {{agent}} etc. to personalise."}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {visible.map((t) => (
            <div key={t._id} className="panel" style={{ padding: 16 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-ink text-[14px] truncate">{t.name}</div>
                  {t.channel === "whatsapp" ? (
                    <div className="hint m-0 truncate">
                      <code>{t.waName}</code> · {t.waLanguage}
                    </div>
                  ) : (
                    <div className="hint m-0 truncate">Subject: {t.subjectPreview || t.subject}</div>
                  )}
                </div>
                {t.channel === "whatsapp" && <span className={`pill ${WA_STATUS_CLS[t.waStatus] || "bg-bg text-muted"}`}>{t.waStatus || "manual"}</span>}
              </div>
              <div className="mt-2 rounded-xl bg-bg px-3 py-2.5 text-[12.5px] text-ink whitespace-pre-wrap max-h-[120px] overflow-hidden" style={{ lineHeight: 1.45 }}>
                {t.preview}
              </div>
              {t.channel === "whatsapp" && t.waBodyParams?.length > 0 && (
                <div className="hint mt-2 mb-0">
                  {t.waBodyParams.map((p, i) => (
                    <span key={i} className="inline-block mr-1.5">
                      {`{{${i + 1}}}`}→{p}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button className="btn-sm btn-export" onClick={() => openTest(t)} disabled={t.channel === "whatsapp" && t.waStatus && t.waStatus !== "APPROVED"} title="Send this template to your own number / email with sample values">
                  Send test
                </button>
                <button className="btn-sm" onClick={() => setEditing({ ...t })}>
                  Edit
                </button>
                <button className="btn-sm text-danger border-danger/30 hover:bg-danger/5" onClick={() => archive(t)}>
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testing && (
        <div className="modal-backdrop" onClick={() => setTesting(null)}>
          <div className="modal max-w-[460px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Send test — {testing.name}</h2>
              <button className="btn-icon" onClick={() => setTesting(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="p-5">
              <div className="field mb-0">
                <label>{testing.channel === "whatsapp" ? "Your WhatsApp number" : "Your email"}</label>
                <input
                  autoFocus
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !sendingTest && sendTest()}
                  placeholder={testing.channel === "whatsapp" ? "91 98765 43210" : "you@example.com"}
                />
              </div>
              <p className="hint mt-2 mb-0">
                Sent with sample values (Ravi Kumar, Q5, Hyderabad…) from this company's {testing.channel === "whatsapp" ? "WhatsApp number" : "email sender"}.
                {testing.channel === "whatsapp" && " On a Meta test number, only recipients added under “To” in the App Dashboard receive it."}
              </p>
              <div className="mt-3 rounded-xl bg-bg px-3 py-2.5 text-[12.5px] text-ink whitespace-pre-wrap" style={{ lineHeight: 1.45 }}>
                {testing.channel === "email" && <div className="font-semibold mb-1">{testing.subjectPreview}</div>}
                {testing.preview}
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <button className="btn-sm" onClick={() => setTesting(null)}>
                  Cancel
                </button>
                <button className="btn-sm btn-export" disabled={sendingTest} onClick={sendTest}>
                  {sendingTest ? "Sending…" : "Send test"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal max-w-[720px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {editing._id ? "Edit" : "New"} {editing.channel === "whatsapp" ? "WhatsApp" : "email"} template
              </h2>
              <button className="btn-icon" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <div className="grid gap-3" style={{ gridTemplateColumns: editing.channel === "whatsapp" ? "1fr 1fr" : "1fr" }}>
                <div className="field mb-0">
                  <label>Template name (internal)</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Diwali offer" />
                </div>
                {editing.channel === "whatsapp" && (
                  <div className="field mb-0">
                    <label>Meta template name · language</label>
                    <div className="flex gap-2">
                      <input value={editing.waName} onChange={(e) => setEditing({ ...editing, waName: e.target.value })} placeholder="diwali_offer_2026" />
                      <input value={editing.waLanguage} onChange={(e) => setEditing({ ...editing, waLanguage: e.target.value })} style={{ width: 80 }} placeholder="en" />
                    </div>
                  </div>
                )}
              </div>
              {editing.channel === "email" && (
                <div className="field mt-3 mb-0">
                  <label>Subject</label>
                  <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="{{first_name}}, your {{model}} test drive is waiting" />
                </div>
              )}
              <div className="field mt-3 mb-0">
                <label>{editing.channel === "whatsapp" ? "Body (as approved in Meta — keep the {{1}} {{2}} placeholders)" : "Body"}</label>
                <textarea rows={7} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} style={{ fontFamily: "inherit" }} />
              </div>
              {editing.channel === "email" && (
                <div className="hint mt-1.5">
                  Variables:{" "}
                  {variables.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className="pill bg-bg text-ink mr-1 mb-1 cursor-pointer border-none"
                      title={v.label}
                      onClick={() => setEditing({ ...editing, body: `${editing.body || ""}{{${v.key}}}` })}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              )}
              {editing.channel === "whatsapp" && placeholders.length > 0 && (
                <div className="mt-3">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-muted mb-1.5">Placeholder mapping</div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                    {placeholders.map((n) => (
                      <div key={n} className="field mb-0">
                        <label>{`{{${n}}}`}</label>
                        <select
                          value={editing.waBodyParams?.[n - 1] || "name"}
                          onChange={(e) => {
                            const arr = [...(editing.waBodyParams || [])];
                            while (arr.length < n) arr.push("name");
                            arr[n - 1] = e.target.value;
                            setEditing({ ...editing, waBodyParams: arr });
                          }}
                        >
                          {variables.map((v) => (
                            <option key={v.key} value={v.key}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mt-5">
                <button className="btn-sm" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn-sm btn-export" disabled={saving} onClick={save}>
                  {saving ? "Saving…" : "Save template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
