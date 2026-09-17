import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
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
  const router = useRouter();
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
  const [showManual, setShowManual] = useState(false);

  // Facebook Login for Business: page picker shown after the OAuth
  // callback has stored the admin's manageable Pages (see
  // pages/api/auth/meta/callback.js).
  const [picker, setPicker] = useState(null); // { fbUserName, pages: [...] }
  const [pickerLoading, setPickerLoading] = useState(false);
  const [choosing, setChoosing] = useState("");

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
    const conv = d.converted ? " — your user token was converted to the Page's own non-expiring token" : "";
    toast(`Connected "${d.page.pageName || d.page.pageId}"${d.page.instagramUsername ? ` (Instagram @${d.page.instagramUsername})` : ""}${conv}${missing}`, {
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
    setBusy(`${pageId}:remove`);
    try {
      const res = await apiFetch(`/api/meta/disconnect-page${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to disconnect");
      toast("Page disconnected");
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setBusy("");
    }
  }

  // "Connect Facebook" — a full-page redirect through Facebook Login for
  // Business; we come back to this page with ?fb=pick|error|nopages.
  function connectFacebook() {
    window.location.href = `/api/auth/meta${qs()}`;
  }

  const openPicker = useCallback(async () => {
    setPickerLoading(true);
    try {
      const res = await apiFetch(`/api/meta/pages${qs()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load your Facebook Pages");
      if (d.expired || !d.pages?.length) {
        toast("The Facebook login has expired - click Connect Facebook again", { type: "err" });
        return;
      }
      setPicker(d);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setPickerLoading(false);
    }
  }, [qs, toast]);

  async function choosePage(pageId) {
    setChoosing(pageId);
    try {
      const res = await apiFetch(`/api/meta/connect-page${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not connect the Page");
      setPicker(null);
      toast(
        `Connected "${d.page.pageName || pageId}"${d.page.instagramUsername ? ` (Instagram @${d.page.instagramUsername})` : ""}${
          d.page.subscribed ? " - leadgen webhook subscribed" : d.subscribeError ? ` - subscription failed: ${d.subscribeError}` : ""
        }`,
        { type: d.page.subscribed ? "ok" : "err" }
      );
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setChoosing("");
    }
  }

  // Handle the flags the OAuth callback appends when it sends us back.
  useEffect(() => {
    if (!router.isReady) return;
    const { fb, reason, ...rest } = router.query;
    if (!fb) return;
    if (fb === "pick") openPicker();
    else toast(reason || (fb === "nopages" ? "No Facebook Pages found for that account" : "Facebook connection failed"), { type: "err" });
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

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
          <div className="dash-card-caption">{connected ? config.pages.map((p) => p.pageName || p.pageId).join(", ") : "Use Connect Facebook below"}</div>
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
          <h2>Facebook connection</h2>
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

          {config.pages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg p-5 text-center">
              <div className="font-semibold mb-1">No Facebook Page connected</div>
              <div className="hint mb-4">
                Sign in with a Facebook account that manages this company&apos;s Page. You&apos;ll pick the Page on the next screen; the
                CRM stores its access token encrypted and subscribes it to lead notifications automatically.
              </div>
              <button type="button" className="btn" onClick={connectFacebook} disabled={!app.loginConfigured}>
                Connect Facebook
              </button>
              {!app.loginConfigured && <div className="hint mt-2 text-danger">META_APP_ID / META_APP_SECRET must be set on the server first.</div>}
              {config.oauth?.pendingPages > 0 && (
                <div className="mt-3">
                  <button type="button" className="btn-sm" onClick={openPicker} disabled={pickerLoading}>
                    {pickerLoading ? "Loading…" : `Choose from ${config.oauth.pendingPages} Page${config.oauth.pendingPages === 1 ? "" : "s"} found`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {config.pages.map((p) => (
                <div key={p.pageId} className="rounded-xl border border-border bg-bg p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[15px]">{p.pageName || "Untitled page"}</span>
                        <StatusPill ok={p.hasToken || app.fallbackTokenSet}>{p.hasToken ? "Connected" : app.fallbackTokenSet ? "Server token" : "No token"}</StatusPill>
                        <StatusPill ok={p.subscribed} warn={!p.subscribed}>
                          {p.subscribed ? "Leadgen webhook subscribed" : "Webhook not subscribed"}
                        </StatusPill>
                      </div>
                      <div className="hint mt-1">
                        Page ID {p.pageId}
                        {p.instagramUsername ? ` · Instagram @${p.instagramUsername}` : ""}
                        {p.connectedVia === "oauth" ? ` · connected via Facebook Login${p.connectedBy ? ` (${p.connectedBy})` : ""}` : p.connectedVia === "manual" ? " · manual token" : ""}
                        {p.connectedAt ? ` · since ${new Date(p.connectedAt).toLocaleDateString()}` : ""}
                        {p.lastVerifiedAt ? ` · last checked ${fmt(p.lastVerifiedAt)}` : ""}
                      </div>
                      {p.lastVerifyError && <div className="hint mt-1 text-danger whitespace-normal">{p.lastVerifyError}</div>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button className="btn-sm" onClick={() => verifyPage(p.pageId)} disabled={busy === `${p.pageId}:verify`}>
                        {busy === `${p.pageId}:verify` ? "Testing…" : "Test connection"}
                      </button>
                      {!p.subscribed && (
                        <button className="btn-sm" onClick={() => subscribePage(p.pageId)} disabled={busy === `${p.pageId}:subscribe`}>
                          {busy === `${p.pageId}:subscribe` ? "Subscribing…" : "Subscribe leadgen"}
                        </button>
                      )}
                      <button className="btn-sm" onClick={connectFacebook} disabled={!app.loginConfigured}>
                        Reconnect
                      </button>
                      <button className="btn-sm" onClick={() => removePage(p.pageId)} disabled={busy === `${p.pageId}:remove`}>
                        {busy === `${p.pageId}:remove` ? "Removing…" : "Disconnect"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div>
                <button type="button" className="btn-sm" onClick={connectFacebook} disabled={!app.loginConfigured}>
                  + Connect another Page
                </button>
              </div>
            </div>
          )}

          <div className="hint mt-4">
            <button type="button" className="text-accent font-semibold underline-offset-2 hover:underline" onClick={() => setShowManual((v) => !v)}>
              {showManual ? "Hide" : "Advanced:"} connect with a System User token instead
            </button>
          </div>
          {showManual && (
            <form onSubmit={connectPage} className="mt-3 grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] gap-3 items-end">
              <div className="field mb-0">
                <label>Facebook Page ID</label>
                <input value={newPageId} onChange={(e) => setNewPageId(e.target.value)} placeholder="1234567890" required />
              </div>
              <div className="field mb-0">
                <label>Page access token</label>
                <input
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="EAA… (System User or Page token with leads_retrieval)"
                  autoComplete="off"
                />
              </div>
              <button className="btn-sm" type="submit" disabled={busy === "connect"}>
                {busy === "connect" ? "Connecting…" : "Connect with token"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Page picker modal (after Facebook Login) */}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div className="modal max-w-[560px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Select the Facebook Page for this company</h2>
                {picker.fbUserName && <div className="hint mt-0.5">Signed in as {picker.fbUserName}</div>}
              </div>
              <button className="btn-icon" onClick={() => setPicker(null)}>
                &times;
              </button>
            </div>
            <div className="p-5 flex flex-col gap-2">
              {picker.pages.map((p) => {
                const blocked = p.connectedToOtherCompany || !p.hasToken || !p.canManage;
                return (
                  <div key={p.pageId} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.pageName || "Untitled page"}</div>
                      <div className="hint m-0">
                        ID {p.pageId}
                        {p.instagramUsername ? ` · Instagram @${p.instagramUsername}` : ""}
                        {p.alreadyConnected ? " · already connected here" : ""}
                        {p.connectedToOtherCompany ? " · connected to another company" : ""}
                        {!p.hasToken ? " · no access token (needs Manage role)" : ""}
                      </div>
                    </div>
                    <button className="btn-sm btn-export" onClick={() => choosePage(p.pageId)} disabled={blocked || Boolean(choosing)}>
                      {choosing === p.pageId ? "Connecting…" : p.alreadyConnected ? "Reconnect" : "Connect"}
                    </button>
                  </div>
                );
              })}
              <div className="hint mt-1">
                Only Pages your Facebook account manages are listed. If the Page you need is missing, cancel and use Connect Facebook
                again, making sure that Page is ticked in the Facebook dialog.
              </div>
            </div>
          </div>
        </div>
      )}

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
