import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import { WhatsAppIcon } from "./icons";

// Per-company marketing senders: the company's own WhatsApp Business
// number (Cloud API) and its own email sender (Brevo key optional). Used on
// the Campaigns page (Settings tab, company admins) and inside the
// Companies card (super admin, any company via companyId).

function qs(companyId) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : "";
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}` }));

function StatusDot({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${ok ? "text-success" : "text-muted"}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-border"}`} />
      {label}
    </span>
  );
}

export default function MessagingSettingsPanel({ companyId = "", compact = false }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [wa, setWa] = useState({ wabaId: "", phoneNumberId: "", accessToken: "" });
  const [em, setEm] = useState({ fromName: "", fromEmail: "", replyTo: "", brevoApiKey: "" });
  const [rules, setRules] = useState({ timezone: "Asia/Kolkata", quietHoursStart: 21, quietHoursEnd: 9, weeklyCap: 2 });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/messaging/settings${qs(companyId)}`);
    if (res.ok) {
      const d = await res.json();
      setData(d);
      setWa({ wabaId: d.config.whatsapp.wabaId, phoneNumberId: d.config.whatsapp.phoneNumberId, accessToken: "" });
      setEm({ fromName: d.config.email.fromName, fromEmail: d.config.email.fromEmail, replyTo: d.config.email.replyTo, brevoApiKey: "" });
      setRules({ timezone: d.config.timezone, quietHoursStart: d.config.quietHoursStart, quietHoursEnd: d.config.quietHoursEnd, weeklyCap: d.config.weeklyCap });
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body, which) {
    setSaving(which);
    try {
      const res = await apiFetch(`/api/messaging/settings${qs(companyId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(d.error || "Could not save", { type: "err" });
        if (d.config) setData((prev) => ({ ...prev, config: d.config }));
        return false;
      }
      setData((prev) => ({ ...prev, config: d.config }));
      toast("Saved", { type: "ok" });
      return true;
    } finally {
      setSaving("");
    }
  }

  if (loading || !data) return <div className="hint">Loading messaging settings…</div>;
  const w = data.config.whatsapp;
  const e = data.config.email;

  return (
    <div className={compact ? "" : "grid gap-4"} style={compact ? {} : { gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      {/* WhatsApp */}
      <div className="panel" style={{ padding: 20 }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#e7f9ee] text-[#128c7e]">
              <WhatsAppIcon />
            </span>
            <div>
              <div className="font-bold text-ink text-[14px]">WhatsApp Business number</div>
              <div className="hint m-0">This company's own number via the WhatsApp Cloud API</div>
            </div>
          </div>
          <StatusDot ok={Boolean(w.verifiedAt)} label={w.verifiedAt ? "Connected" : "Not connected"} />
        </div>
        {w.verifiedAt && (
          <div className="rounded-xl bg-bg px-3.5 py-2.5 mb-3 text-[13px]">
            <div className="font-semibold text-ink">
              {w.displayName || "—"} · {w.displayPhone || "—"}
            </div>
            <div className="hint m-0">
              Quality {w.qualityRating || "n/a"} · token {w.tokenPreview} · verified {fmtDate(w.verifiedAt)}
            </div>
            <div className={`text-[12px] font-semibold mt-1 ${w.webhookSubscribed ? "text-success" : "text-[#b45309]"}`}>
              {w.webhookSubscribed ? "✓ Webhooks reach this CRM (app subscribed to the WhatsApp account)" : "⚠ CRM app is not subscribed to this WhatsApp account — replies will not arrive. Click Save & verify again."}
              {w.tokenAppName && <span className="text-muted font-normal"> · token app: {w.tokenAppName}</span>}
            </div>
          </div>
        )}
        {w.lastError && <div className="save-msg text-danger mb-2">{w.lastError}</div>}
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field mb-0">
            <label>WhatsApp Business Account ID</label>
            <input value={wa.wabaId} onChange={(ev) => setWa({ ...wa, wabaId: ev.target.value })} placeholder="1234567890" />
          </div>
          <div className="field mb-0">
            <label>Phone number ID</label>
            <input value={wa.phoneNumberId} onChange={(ev) => setWa({ ...wa, phoneNumberId: ev.target.value })} placeholder="1098765432" />
          </div>
        </div>
        <div className="field mt-2.5 mb-0">
          <label>System user access token {w.hasToken && <span className="text-muted font-normal">(stored — leave blank to keep)</span>}</label>
          <input type="password" value={wa.accessToken} onChange={(ev) => setWa({ ...wa, accessToken: ev.target.value })} placeholder={w.hasToken ? w.tokenPreview : "EAAG…"} autoComplete="off" />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button className="btn-sm btn-export" disabled={saving === "wa"} onClick={() => patch({ whatsapp: wa }, "wa")}>
            {saving === "wa" ? "Verifying…" : "Save & verify"}
          </button>
          {w.hasToken && (
            <button
              className="btn-sm text-danger border-danger/30 hover:bg-danger/5"
              disabled={saving === "wa"}
              onClick={() => window.confirm("Disconnect this WhatsApp number? Campaigns on WhatsApp will stop.") && patch({ whatsapp: { clear: true } }, "wa")}
            >
              Disconnect
            </button>
          )}
        </div>
        <p className="hint mt-3 mb-0">
          Meta Business Suite → WhatsApp Manager → API setup. Webhook URL for the app: <code>{data.app.whatsappWebhookUrl}</code> (field <code>messages</code>).
        </p>
      </div>

      {/* Email */}
      <div className="panel" style={{ padding: 20 }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef3ff] text-[#1d4ed8]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <div>
              <div className="font-bold text-ink text-[14px]">Email sender</div>
              <div className="hint m-0">Campaign emails go out from this company's own address</div>
            </div>
          </div>
          <StatusDot ok={Boolean(e.fromEmail && e.provider)} label={e.fromEmail && e.provider ? `Ready · ${e.provider}` : "Not set"} />
        </div>
        {e.lastError && <div className="save-msg text-danger mb-2">{e.lastError}</div>}
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field mb-0">
            <label>From name</label>
            <input value={em.fromName} onChange={(ev) => setEm({ ...em, fromName: ev.target.value })} placeholder="Audi Hyderabad" />
          </div>
          <div className="field mb-0">
            <label>From email</label>
            <input value={em.fromEmail} onChange={(ev) => setEm({ ...em, fromEmail: ev.target.value })} placeholder="offers@audihyderabad.in" />
          </div>
        </div>
        <div className="grid gap-2.5 mt-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field mb-0">
            <label>Reply-to (optional)</label>
            <input value={em.replyTo} onChange={(ev) => setEm({ ...em, replyTo: ev.target.value })} placeholder="sales@…" />
          </div>
          <div className="field mb-0">
            <label>
              Brevo API key {e.hasKey && <span className="text-muted font-normal">(stored)</span>}
              {!e.hasKey && e.platformKey && <span className="text-muted font-normal">(using platform key)</span>}
            </label>
            <input type="password" value={em.brevoApiKey} onChange={(ev) => setEm({ ...em, brevoApiKey: ev.target.value })} placeholder={e.hasKey ? e.keyPreview : "xkeysib-…"} autoComplete="off" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button className="btn-sm btn-export" disabled={saving === "em"} onClick={() => patch({ email: em }, "em")}>
            {saving === "em" ? "Saving…" : "Save"}
          </button>
          {e.hasKey && (
            <button className="btn-sm text-danger border-danger/30 hover:bg-danger/5" disabled={saving === "em"} onClick={() => patch({ email: { clearKey: true } }, "em")}>
              Remove key
            </button>
          )}
        </div>
        <p className="hint mt-3 mb-0">
          {e.provider === "brevo"
            ? "Delivery, opens and clicks are tracked through Brevo."
            : e.smtpFallback
            ? "No Brevo key — emails go out through the platform SMTP (no open/click tracking). Add a Brevo key for tracking."
            : "No email provider configured yet. Add a Brevo API key (free tier: 300 emails/day) or set SMTP_* on the server."}
          {" "}Verify the from-domain in Brevo (Senders & IPs) so emails land in the inbox.
        </p>
      </div>

      {/* Rules */}
      <div className="panel" style={{ padding: 20, gridColumn: compact ? undefined : "1 / -1" }}>
        <div className="font-bold text-ink text-[14px] mb-0.5">Sending rules</div>
        <div className="hint mb-3">Applied to every campaign of this company — keeps the number healthy and customers unannoyed.</div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div className="field mb-0">
            <label>Timezone</label>
            <input value={rules.timezone} onChange={(ev) => setRules({ ...rules, timezone: ev.target.value })} />
          </div>
          <div className="field mb-0">
            <label>Quiet hours from</label>
            <select value={rules.quietHoursStart} onChange={(ev) => setRules({ ...rules, quietHoursStart: Number(ev.target.value) })}>
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field mb-0">
            <label>Quiet hours until</label>
            <select value={rules.quietHoursEnd} onChange={(ev) => setRules({ ...rules, quietHoursEnd: Number(ev.target.value) })}>
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field mb-0">
            <label>Max messages / customer / week</label>
            <input type="number" min="0" max="20" value={rules.weeklyCap} onChange={(ev) => setRules({ ...rules, weeklyCap: Number(ev.target.value) })} />
          </div>
        </div>
        <div className="mt-3">
          <button className="btn-sm btn-export" disabled={saving === "rules"} onClick={() => patch(rules, "rules")}>
            {saving === "rules" ? "Saving…" : "Save rules"}
          </button>
        </div>
      </div>
    </div>
  );
}
