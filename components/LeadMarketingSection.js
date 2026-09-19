import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

// "Marketing" block inside the lead detail modal: which campaign messages
// this customer received (and what happened to them) plus per-channel
// opt-out switches an agent can flip when the customer asks on a call.

const STATUS_CLS = {
  queued: "bg-bg text-muted",
  sent: "bg-[#eef3ff] text-[#1d4ed8]",
  delivered: "bg-[#e0f2fe] text-[#0369a1]",
  read: "bg-[#ede9fe] text-[#6d28d9]",
  opened: "bg-[#ede9fe] text-[#6d28d9]",
  clicked: "bg-[#ede9fe] text-[#6d28d9]",
  replied: "bg-[#ecfdf5] text-[#047857]",
  failed: "bg-[#fef2f2] text-[#b91c1c]",
  bounced: "bg-[#fef2f2] text-[#b91c1c]",
  skipped: "bg-[#fff7ed] text-[#c2410c]",
};

export default function LeadMarketingSection({ leadId, companyId, readOnly }) {
  const toast = useToast();
  const url = `/api/leads/${leadId}/marketing${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`;
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d || { messages: [] }));
    return () => {
      alive = false;
    };
  }, [url]);

  async function toggle(field, value) {
    setSaving(field);
    const res = await apiFetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    setSaving("");
    if (!res.ok) return toast("Could not update opt-out", { type: "err" });
    setData((d) => ({ ...d, [field]: value }));
    toast(value ? "Customer opted out" : "Customer opted back in", { type: "ok" });
  }

  if (!data) return <div className="hint">Loading…</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2.5">
        {[
          ["whatsappOptOut", "WhatsApp marketing"],
          ["emailOptOut", "Email marketing"],
        ].map(([field, label]) => {
          const out = Boolean(data[field]);
          return (
            <label key={field} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] cursor-pointer ${out ? "border-danger/30 bg-danger/5 text-danger" : "border-border bg-card text-ink"}`}>
              <input type="checkbox" checked={out} disabled={readOnly || saving === field} onChange={(e) => toggle(field, e.target.checked)} />
              {out ? `Opted out of ${label.toLowerCase()}` : `${label}: allowed`}
            </label>
          );
        })}
      </div>
      {data.messages.length === 0 ? (
        <div className="hint">No campaign messages sent to this customer yet.</div>
      ) : (
        <ul className="timeline">
          {data.messages.map((m) => (
            <li key={m._id}>
              <span className={`pill ${STATUS_CLS[m.status] || "bg-bg text-muted"}`} style={{ minWidth: 76, justifyContent: "center" }}>
                {m.status}
              </span>
              <span className="timeline-date">{m.sentAt ? new Date(m.sentAt).toLocaleString() : new Date(m.createdAt).toLocaleString()}</span>
              <span className="text-muted">
                {m.channel === "whatsapp" ? "WhatsApp" : "Email"} · {m.campaign?.name || "campaign"}
                {m.replyText ? ` · reply: “${m.replyText}”` : ""}
                {m.error ? ` · ${m.error}` : ""}
                {m.skipReason ? ` · ${m.skipReason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
