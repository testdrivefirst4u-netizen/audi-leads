import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { useToast } from "../../components/ToastProvider";
import { getSessionFromCookieHeader } from "../../lib/auth";
import { getCompanyBranding } from "../../lib/companyBranding";
import { apiFetch } from "../../lib/apiFetch";
import { STATUS_META, ChannelBadge } from "../../components/campaignBits";

// One campaign: funnel, progress, per-customer messages. While the
// campaign is "sending" this page drives it — it keeps calling
// ?action=process so batches go out even where no cron runs (Vercel
// Hobby), the same way the chunked Excel import works.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role === "agent") return { redirect: { destination: "/leads", permanent: false } };
  const branding = session.role === "super_admin" ? {} : await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

const MSG_STATUS_CLS = {
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

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : "—";
}

export default function CampaignReportPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const toast = useToast();
  const { id } = router.query;
  const companyId = role === "super_admin" && typeof router.query.companyId === "string" ? router.query.companyId : "";
  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    if (companyId) p.set("companyId", companyId);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const [data, setData] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [lastBatch, setLastBatch] = useState(null);
  const processing = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await apiFetch(`/api/messaging/campaigns/${id}${qs({ status: statusFilter, page })}`);
    if (res.ok) setData(await res.json());
    else if (res.status === 404) router.replace(`/campaigns${qs()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, statusFilter, page, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Drive sending while the campaign is in progress.
  useEffect(() => {
    if (!data || data.campaign.status !== "sending") return;
    let stop = false;
    const tick = async () => {
      if (stop || processing.current) return;
      processing.current = true;
      try {
        const res = await apiFetch(`/api/messaging/campaigns/${id}${qs({ action: "process", batch: 20 })}`, { method: "POST" });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          setLastBatch(d.batch);
          if (d.batch?.error) toast(d.batch.error, { type: "err" });
        }
      } finally {
        processing.current = false;
      }
      if (!stop) load();
    };
    const t = setInterval(tick, lastBatch?.quietHours ? 60000 : 2500);
    tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.campaign.status, id, companyId]);

  async function act(action, body) {
    setBusy(action);
    try {
      const res = await apiFetch(`/api/messaging/campaigns/${id}${qs({ action })}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast(d.error || `Could not ${action}`, { type: "err" });
      toast(action === "send" ? `Sending to ${d.queued} customers` : `Campaign ${action === "cancel" ? "cancelled" : action + "d"}`, { type: "ok" });
      load();
    } finally {
      setBusy("");
    }
  }

  if (!data) {
    return (
      <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
        <div className="hint">Loading campaign…</div>
      </Layout>
    );
  }

  const c = data.campaign;
  const s = c.stats || {};
  const meta = STATUS_META[c.status] || STATUS_META.draft;
  const engaged = (s.read || 0) + (s.opened || 0) + (s.clicked || 0);
  const done = (s.sent || 0) + (s.failed || 0) + (s.skipped || 0);
  const progress = s.queued ? Math.min(100, Math.round((done / s.queued) * 100)) : 0;
  const isWa = c.channel === "whatsapp";
  const funnel = [
    ["Audience", s.audience || 0, "#64748b"],
    ["Sent", s.sent || 0, "#3d5afe", pct(s.sent, s.queued)],
    ["Delivered", s.delivered || 0, "#0ea5e9", pct(s.delivered, s.sent)],
    [isWa ? "Read" : "Opened", engaged, "#8b5cf6", pct(engaged, s.sent)],
    ["Replies", s.replied || 0, "#10b981", pct(s.replied, s.sent)],
    ["Failed / bounced", (s.failed || 0) + (s.bounced || 0), "#ef4444"],
  ];

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <div className="mb-3">
        <Link href={`/campaigns${qs()}`} className="hint no-underline hover:underline">
          ← All campaigns
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="page-title mb-1">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <ChannelBadge channel={c.channel} />
            <span className={`pill ${meta.cls}`}>{meta.label}</span>
            {data.template && <span className="hint m-0">Template: {data.template.name}</span>}
            {c.scheduledAt && c.status === "scheduled" && <span className="hint m-0">Scheduled for {new Date(c.scheduledAt).toLocaleString()}</span>}
            {c.startedAt && <span className="hint m-0">Started {new Date(c.startedAt).toLocaleString()}</span>}
            {c.finishedAt && <span className="hint m-0">Finished {new Date(c.finishedAt).toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["draft", "scheduled"].includes(c.status) && (
            <button className="btn-sm btn-export" disabled={Boolean(busy) || !data.preview?.eligible} onClick={() => window.confirm(`Send to ${data.preview?.eligible} customers now?`) && act("send")}>
              {busy === "send" ? "Starting…" : `Send now (${data.preview?.eligible ?? 0})`}
            </button>
          )}
          {c.status === "scheduled" && (
            <button className="btn-sm" disabled={Boolean(busy)} onClick={() => act("unschedule")}>
              Unschedule
            </button>
          )}
          {c.status === "sending" && (
            <button className="btn-sm" disabled={Boolean(busy)} onClick={() => act("pause")}>
              Pause
            </button>
          )}
          {c.status === "paused" && (
            <button className="btn-sm btn-export" disabled={Boolean(busy)} onClick={() => act("resume")}>
              Resume
            </button>
          )}
          {["sending", "paused"].includes(c.status) && (
            <button className="btn-sm text-danger border-danger/30 hover:bg-danger/5" disabled={Boolean(busy)} onClick={() => window.confirm("Cancel the rest of this campaign?") && act("cancel")}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {c.lastError && <div className="save-msg text-danger mb-3">{c.lastError}</div>}

      {c.status === "sending" && (
        <div className="panel mb-4" style={{ padding: 16 }}>
          <div className="flex items-center justify-between gap-3 mb-2 text-[13px]">
            <span className="font-semibold text-ink">
              Sending… {done.toLocaleString()} of {(s.queued || 0).toLocaleString()}
            </span>
            <span className="hint m-0">
              {lastBatch?.quietHours ? "Quiet hours — will resume automatically" : "Keep this page open; messages go out in batches"}
            </span>
          </div>
          <div className="bar-track" style={{ height: 8 }}>
            <div className="bar-fill" style={{ width: `${progress}%`, height: 8 }} />
          </div>
        </div>
      )}

      {["draft", "scheduled"].includes(c.status) && data.preview && (
        <div className="dash-stat-grid">
          <div className="dash-card" style={{ "--dash-accent": "#3d5afe" }}>
            <div className="label">Will send to</div>
            <div className="value">{data.preview.eligible.toLocaleString()}</div>
            <div className="dash-card-caption">{data.preview.matched.toLocaleString()} match filters · {data.preview.excluded.toLocaleString()} excluded</div>
          </div>
          {data.sampleRender && (
            <div className="dash-card" style={{ "--dash-accent": "#8b5cf6", gridColumn: "span 2" }}>
              <div className="label">Message preview</div>
              {data.sampleRender.subject && <div className="font-semibold text-ink text-[13px] mb-1">{data.sampleRender.subject}</div>}
              <div className="text-[13px] text-ink whitespace-pre-wrap" style={{ lineHeight: 1.45 }}>
                {data.sampleRender.body}
              </div>
            </div>
          )}
        </div>
      )}

      {!["draft", "scheduled"].includes(c.status) && (
        <>
          <div className="dash-stat-grid">
            {funnel.map(([label, value, color, caption]) => (
              <div key={label} className="dash-card" style={{ "--dash-accent": color }}>
                <div className="label">{label}</div>
                <div className="value">{value.toLocaleString()}</div>
                {caption && <div className="dash-card-caption">{caption}</div>}
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Messages ({(data.messagesTotal || 0).toLocaleString()})</h2>
              <select
                className="search-input"
                style={{ maxWidth: 200 }}
                value={statusFilter}
                onChange={(e) => {
                  setPage(1);
                  setStatusFilter(e.target.value);
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(data.byStatus || {}).map(([k, n]) => (
                  <option key={k} value={k}>
                    {k} ({n})
                  </option>
                ))}
              </select>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>{isWa ? "Phone" : "Email"}</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>{isWa ? "Read" : "Opened"}</th>
                    <th>Reply / note</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.messages || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-muted">
                        No messages{statusFilter ? ` with status ${statusFilter}` : ""}.
                      </td>
                    </tr>
                  )}
                  {(data.messages || []).map((m) => (
                    <tr key={m._id}>
                      <td>
                        {m.lead ? (
                          <Link href={`/leads?q=${encodeURIComponent(m.lead.phone || m.lead.email || "")}${companyId ? `&companyId=${companyId}` : ""}`} className="font-semibold text-ink no-underline hover:underline">
                            {m.lead.name || "—"}
                          </Link>
                        ) : (
                          <span className="text-muted">Deleted lead</span>
                        )}
                      </td>
                      <td>{m.to}</td>
                      <td>{m.lead?.canonicalModel || ""}</td>
                      <td>
                        <span className={`pill ${MSG_STATUS_CLS[m.status] || "bg-bg text-muted"}`}>{m.status}</span>
                      </td>
                      <td className="text-muted">{m.sentAt ? new Date(m.sentAt).toLocaleString() : ""}</td>
                      <td className="text-muted">{m.readAt ? new Date(m.readAt).toLocaleString() : ""}</td>
                      <td className="remark-cell" style={{ whiteSpace: "normal", maxWidth: 320 }}>
                        {m.replyText || m.error || m.skipReason || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.messagesTotal > data.pageSize && (
              <div className="pagination">
                <span className="hint m-0">
                  {(data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.messagesTotal)} of {data.messagesTotal}
                </span>
                <div className="pagination-controls">
                  <button className="btn-sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                    Prev
                  </button>
                  <button className="btn-sm" disabled={data.page * data.pageSize >= data.messagesTotal} onClick={() => setPage(data.page + 1)}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
