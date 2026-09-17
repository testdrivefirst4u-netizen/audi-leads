import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";

// Meta Lead Ads settings for one company — connection, connected Facebook
// Pages (each with its own access token, stored encrypted server-side),
// webhook details, and the event log with retry. Rendered by
// pages/meta-integration.js for a company admin (own company) and for the
// super admin (company picked via CompanySwitcher → `companyId`).

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "—";
}

function StatusPill({ ok, warn, children }) {
  const cls = ok ? "bg-success/10 text-success" : warn ? "bg-[#fffbeb] text-[#b45309]" : "bg-danger/10 text-danger";
  return <span className={`pill ${cls}`}>{children}</span>;
}

const EVENT_STATUS = {
  processed: { label: "Lead created", cls: "bg-success/10 text-success" },
  duplicate: { label: "Repeat enquiry", cls: "bg-[#fffbeb] text-[#b45309]" },
  received: { label: "Received", cls: "bg-accent-soft text-accent" },
  unmapped: { label: "Page not connected", cls: "bg-[#f5f3ff] text-[#6d28d9]" },
  failed: { label: "Failed", cls: "bg-danger/10 text-danger" },
};

export default function MetaIntegrationPanel({ companyId }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventCounts, setEventCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(""); // "connect" | "<pageId>:verify" | ...
  const [copied, setCopied] = useState(false);

  const [connectionName, setConnectionName] = useState("");
  const [businessPortfolio, setBusinessPortfolio] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [newPageId, setNewPageId] = useState("");
  const [newToken, setNewToken] = useState("");

  const qs = useCallback(() => (companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""), [companyId]);

  const load = useCallback(async () => {
    const [sRes, eRes] = await Promise.all([apiFetch(`/api/meta/settings${qs()}`), apiFetch(`/api/meta/events${qs()}`)]);
    if (!sRes.ok) {
      toast("Failed to load Meta settings", { type: "err" });
      setLoading(false);
      return;
    }
    const s = await sRes.json();
    setData(s);
    setConnectionName(s.config.connectionName || "");
    setBusinessPortfolio(s.config.businessPortfolio || "");
    setEnabled(s.config.enabled !== false);
    if (!newPageId && s.app.defaultPageId && s.config.pages.length === 0) setNewPageId(s.app.defaultPageId);
    if (eRes.ok) {
      const e = await eRes.json();
      setEvents(e.events || []);
      setEventCounts(e.counts || {});
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, toast]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // New leads arrive whenever Meta sends them — keep the event log fresh
  // without the admin having to refresh.
  useEffect(() => {
    const t = setInterval(() => {
      apiFetch(`/api/meta/events${qs()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((e) => {
          if (e) {
            setEvents(e.events || []);
            setEventCounts(e.counts || {});
          }
        })
        .catch(() => {});
    }, 20000);
    return () => clearInterval(t);
  }, [qs]);

  async function saveConnection() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/meta/settings${qs()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionName, businessPortfolio, enabled }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save");
      toast("Meta connection saved");
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function pageAction(action, pageId, extra = {}, key = `${pageId}:${action}`) {
    setBusy(key);
    try {
      const res = await apiFetch(`/api/meta/connect${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pageId, ...extra }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Request failed");
      return d;
    } catch (err) {
      toast(err.message, { type: "err" });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function connectPage(e) {
    e.preventDefault();
    const d = await pageAction("connect", newPageId.trim(), { accessToken: newToken.trim() }, "connect");
    if (!d) return;
    const missing = d.tokenInfo?.missingScopes?.length ? ` — token is missing: ${d.tokenInfo.missingScopes.join(", ")}` : "";
    toast(`Connected "${d.page.pageName || d.page.pageId}"${d.page.instagramUsername ? ` (Instagram @${d.page.instagramUsername})` : ""}${missing}`, {
      type: missing ? "err" : "ok",
    });
    setNewPageId("");
    setNewToken("");
    load();
  }

  async function verifyPage(pageId) {
    const d = await pageAction("verify", pageId);
    if (!d) return;
    const info = d.tokenInfo || {};
    if (info.valid === false) toast("Token is no longer valid — re-connect this page with a fresh token", { type: "err" });
    else if (info.missingScopes?.length) toast(`Token is missing permissions: ${info.missingScopes.join(", ")}`, { type: "err" });
    else {
      const type = info.type ? `token type: ${String(info.type).toUpperCase()}` : "token type unknown";
      const exp = info.expiresAt ? `expires ${new Date(info.expiresAt).toLocaleDateString()}` : info.expiresAt === null ? "never expires" : "";
      const scopes = info.scopes?.length ? `permissions: ${info.scopes.join(", ")}` : "";
      toast(
        `Page verified · ${d.subscribed ? "leadgen webhook subscribed" : "not yet subscribed to leadgen"} · ${[type, exp, scopes].filter(Boolean).join(" · ")}`,
        { type: info.type && String(info.type).toUpperCase() !== "PAGE" ? "err" : "ok" }
      );
    }
    load();
  }

  async function subscribePage(pageId) {
    const d = await pageAction("subscribe", pageId);
    if (!d) return;
    toast(d.subscribed ? "Page subscribed to leadgen webhooks" : "Meta did not confirm the subscription", { type: d.subscribed ? "ok" : "err" });
    load();
  }

  async function removePage(pageId) {
    if (!window.confirm("Disconnect this Page? New leads from it will stop arriving until it is connected again.")) return;
    const d = await pageAction("remove", pageId);
    if (d) {
      toast("Page disconnected");
      load();
    }
  }

  async function retry(eventId) {
    setBusy(eventId ? `retry:${eventId}` : "retryFailed");
    try {
      const res = await apiFetch(`/api/meta/events${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventId ? { action: "retry", eventId } : { action: "retryFailed" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Retry failed");
      if (eventId) toast(`Event is now: ${EVENT_STATUS[d.event.status]?.label || d.event.status}${d.event.lastError ? ` — ${d.event.lastError}` : ""}`, { type: d.event.status === "failed" ? "err" : "ok" });
      else toast(`Retried ${d.summary.retried} event${d.summary.retried === 1 ? "" : "s"}: ${d.summary.processed || 0} created, ${d.summary.duplicate || 0} repeat, ${d.summary.failed || 0} still failing`);
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setBusy("");
    }
  }

  function copyWebhook() {
    navigator.clipboard?.writeText(data.app.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading || !data) {
    return (
      <div className="panel p-5">
        <Skeleton count={6} height={30} className="mb-2" />
      </div>
    );
  }

  const { config, app } = data;
  const appConfigured = Boolean(app.appId && app.appSecretSet && app.verifyTokenSet);
  const connected = config.pages.length > 0;
  const failedCount = (eventCounts.failed || 0) + (eventCounts.unmapped || 0);

  return (
    <>
      {/* Status strip */}
      <div className="dash-stat-grid">
        <div className="dash-card" style={{ "--dash-accent": appConfigured ? "#1baf7a" : "#e5484d" }}>
          <div className="label">App configuration</div>
          <div className="value text-[18px]">{appConfigured ? "Ready" : "Incomplete"}</div>
          <div className="dash-card-caption">
            {app.appId ? `App ID ${app.appId}` : "META_APP_ID not set"} · secret {app.appSecretSet ? "set" : "missing"} · verify token{" "}
            {app.verifyTokenSet ? "set" : "missing"}
          </div>
        </div>
        <div className="dash-card" style={{ "--dash-accent": connected ? "#1baf7a" : "#eda100" }}>
          <div className="label">Connection</div>
          <div className="value text-[18px]">{!config.enabled ? "Disabled" : connected ? `${config.pages.length} page${config.pages.length === 1 ? "" : "s"}` : "No pages"}</div>
          <div className="dash-card-caption">{connected ? config.pages.map((p) => p.pageName || p.pageId).join(", ") : "Connect a Facebook Page below"}</div>
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#2a78d6" }}>
          <div className="label">Last webhook received</div>
          <div className="value text-[18px]">{config.lastWebhookAt ? fmt(config.lastWebhookAt) : "Never"}</div>
          <div className="dash-card-caption">Last lead saved: {config.lastLeadAt ? fmt(config.lastLeadAt) : "never"}</div>
        </div>
        <div className="dash-card" style={{ "--dash-accent": config.lastError ? "#e5484d" : "#94a3b8" }}>
          <div className="label">Last error</div>
          <div className="value text-[15px] whitespace-normal" style={{ lineHeight: 1.3 }}>
            {config.lastError || "None"}
          </div>
          {config.lastErrorAt && <div className="dash-card-caption">{fmt(config.lastErrorAt)}</div>}
        </div>
      </div>

      {/* Webhook details */}
      <div className="panel mb-6">
        <div className="panel-header">
          <h2>Webhook</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <label className="block mb-1.5 text-sm font-semibold">Callback URL</label>
              <div className="flex gap-2">
                <input readOnly value={app.webhookUrl || "(set META_WEBHOOK_URL or open this page on the deployed domain)"} className="flex-1 min-w-0 font-mono text-[12.5px]" />
                <button type="button" className="btn-sm" onClick={copyWebhook} disabled={!app.webhookUrl}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div className="hint mt-1.5">
                Paste this as the <strong>Callback URL</strong> under Webhooks → Page in the Meta App Dashboard, subscribe to the{" "}
                <code>leadgen</code> field, and use your <code>META_VERIFY_TOKEN</code> as the Verify Token.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Verify token</div>
                <StatusPill ok={app.verifyTokenSet}>{app.verifyTokenSet ? "Set" : "Not set"}</StatusPill>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Signature secret</div>
                <StatusPill ok={app.appSecretSet}>{app.appSecretSet ? "Set" : "Not set"}</StatusPill>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Webhook status</div>
                <StatusPill ok={Boolean(config.lastWebhookAt)} warn={!config.lastWebhookAt}>
                  {config.lastWebhookAt ? "Receiving" : "Waiting for first event"}
                </StatusPill>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Graph API version</div>
                <code>{app.apiVersion}</code>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Last successful lead retrieval</div>
                {fmt(config.lastLeadAt)}
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Server fallback token</div>
                <StatusPill ok={app.fallbackTokenSet} warn={!app.fallbackTokenSet}>
                  {app.fallbackTokenSet ? "META_ACCESS_TOKEN set" : "Per-page tokens only"}
                </StatusPill>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection + pages */}
      <div className="panel mb-6">
        <div className="panel-header">
          <h2>Meta connection</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end mb-3">
            <div className="field mb-0">
              <label>Connection name</label>
              <input value={connectionName} onChange={(e) => setConnectionName(e.target.value)} placeholder="Broadcast CRM Integration" />
            </div>
            <div className="field mb-0">
              <label>Business portfolio</label>
              <input value={businessPortfolio} onChange={(e) => setBusinessPortfolio(e.target.value)} placeholder="broaddcast" />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Accept Meta leads
              </label>
              <button type="button" className="btn-sm" onClick={saveConnection} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <div className="hint mb-5">
            App ID <code>{app.appId || "—"}</code> comes from the server environment (META_APP_ID) and is shared by every company; each company
            connects its own Facebook Page(s) here. Instagram lead ads run through the Instagram account linked to the Page, so they need no
            separate connection.
          </div>

          <label className="block mb-1.5 text-sm font-semibold">Connected Facebook Pages</label>
          <div className="table-scroll mb-4">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Instagram</th>
                  <th>Access token</th>
                  <th>Leadgen webhook</th>
                  <th>Last verified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {config.pages.map((p) => (
                  <tr key={p.pageId}>
                    <td>
                      <strong>{p.pageName || "Untitled page"}</strong>
                      <div className="hint m-0">ID {p.pageId}</div>
                    </td>
                    <td className="text-muted">{p.instagramUsername ? `@${p.instagramUsername}` : p.instagramAccountId || "—"}</td>
                    <td>
                      {p.hasToken ? (
                        <>
                          <code>{p.tokenPreview}</code>
                          {p.lastVerifyError && <div className="hint m-0 text-danger whitespace-normal">{p.lastVerifyError}</div>}
                        </>
                      ) : app.fallbackTokenSet ? (
                        <span className="hint">Using server token</span>
                      ) : (
                        <StatusPill ok={false}>No token</StatusPill>
                      )}
                    </td>
                    <td>
                      <StatusPill ok={p.subscribed} warn={!p.subscribed}>
                        {p.subscribed ? "Subscribed" : "Not subscribed"}
                      </StatusPill>
                    </td>
                    <td className="text-muted">{fmt(p.lastVerifiedAt)}</td>
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        <button className="btn-sm" onClick={() => verifyPage(p.pageId)} disabled={busy === `${p.pageId}:verify`}>
                          {busy === `${p.pageId}:verify` ? "Checking…" : "Verify"}
                        </button>
                        <button className="btn-sm" onClick={() => subscribePage(p.pageId)} disabled={busy === `${p.pageId}:subscribe`}>
                          {busy === `${p.pageId}:subscribe` ? "Subscribing…" : "Subscribe leadgen"}
                        </button>
                        <button className="btn-sm" onClick={() => removePage(p.pageId)} disabled={busy === `${p.pageId}:remove`}>
                          Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {config.pages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No Facebook Page connected yet — add one below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form onSubmit={connectPage} className="grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] gap-3 items-end">
            <div className="field mb-0">
              <label>Facebook Page ID</label>
              <input value={newPageId} onChange={(e) => setNewPageId(e.target.value)} placeholder="1234567890" required />
            </div>
            <div className="field mb-0">
              <label>Page access token {app.fallbackTokenSet ? "(optional — server token is used if blank)" : ""}</label>
              <input
                type="password"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="EAAG… (long-lived Page token with leads_retrieval)"
                autoComplete="off"
              />
            </div>
            <button className="btn" type="submit" disabled={busy === "connect"}>
              {busy === "connect" ? "Connecting…" : config.pages.some((p) => p.pageId === newPageId.trim()) ? "Update token" : "Connect Page"}
            </button>
          </form>
          <div className="hint mt-2">
            The token is checked against Meta, stored encrypted, and never shown again. Generate a long-lived Page token for a user who is an
            admin of the Page (Graph API Explorer → your app → Page token, or via a System User in Business settings) with{" "}
            <code>leads_retrieval</code>, <code>pages_show_list</code> and <code>pages_manage_metadata</code>.
          </div>
        </div>
      </div>

      {/* Events */}
      <div className="panel">
        <div className="panel-header flex-wrap gap-3">
          <h2>
            Recent webhook events{" "}
            <span className="hint">
              {Object.entries(eventCounts)
                .map(([k, n]) => `${n} ${EVENT_STATUS[k]?.label?.toLowerCase() || k}`)
                .join(" · ") || "none yet"}
            </span>
          </h2>
          {failedCount > 0 && (
            <button className="btn-sm btn-export" onClick={() => retry(null)} disabled={busy === "retryFailed"}>
              {busy === "retryFailed" ? "Retrying…" : `Retry ${failedCount} failed`}
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Lead ID</th>
                <th>Page</th>
                <th>Status</th>
                <th>CRM lead</th>
                <th>Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const st = EVENT_STATUS[e.status] || EVENT_STATUS.received;
                return (
                  <tr key={e._id}>
                    <td className="text-muted whitespace-nowrap">{fmt(e.createdAt)}</td>
                    <td>
                      <code>{e.leadgenId}</code>
                      {e.platform && <div className="hint m-0 capitalize">{e.platform}</div>}
                    </td>
                    <td className="text-muted">{config.pages.find((p) => p.pageId === e.pageId)?.pageName || e.pageId}</td>
                    <td>
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                      {e.attempts > 1 && <div className="hint m-0">{e.attempts} attempts</div>}
                    </td>
                    <td>
                      {e.leadId ? (
                        <Link href={`/leads?q=${encodeURIComponent(e.leadPhone || e.leadName || "")}`} className="text-accent font-semibold">
                          {e.leadName || "Open lead"}
                        </Link>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td className="whitespace-normal" style={{ maxWidth: 360 }}>
                      <span className="hint">{e.lastError || (e.processedAt ? `Processed ${fmt(e.processedAt)}` : "")}</span>
                    </td>
                    <td>
                      {(e.status === "failed" || e.status === "unmapped" || e.status === "received") && (
                        <button className="btn-sm" onClick={() => retry(e._id)} disabled={busy === `retry:${e._id}`}>
                          {busy === `retry:${e._id}` ? "Retrying…" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No webhook events yet. Once a Page is connected and subscribed, submit a test lead from Meta&apos;s Lead Ads Testing
                    Tool and it will appear here within seconds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
