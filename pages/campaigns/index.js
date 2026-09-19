import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import CompanySwitcher from "../../components/CompanySwitcher";
import CampaignWizard from "../../components/CampaignWizard";
import TemplatesPanel from "../../components/TemplatesPanel";
import MessagingSettingsPanel from "../../components/MessagingSettingsPanel";
import { useToast } from "../../components/ToastProvider";
import { getSessionFromCookieHeader } from "../../lib/auth";
import { getCompanyBranding } from "../../lib/companyBranding";
import { apiFetch } from "../../lib/apiFetch";
import { STATUS_META, ChannelBadge } from "../../components/campaignBits";

// WhatsApp + email marketing campaigns. Company admins run campaigns for
// their own company (their own number / sender); the super admin picks a
// company. Agents are sent to their leads.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role === "agent") return { redirect: { destination: "/leads", permanent: false } };
  const branding = session.role === "super_admin" ? {} : await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

function qs(companyId) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : "—";
}

export default function CampaignsPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdmin = role === "super_admin";
  const router = useRouter();
  const toast = useToast();
  const [companyId, setCompanyId] = useState(() => (typeof router.query.companyId === "string" ? router.query.companyId : ""));
  const [tab, setTab] = useState(() => (typeof router.query.tab === "string" ? router.query.tab : "campaigns"));
  const [campaigns, setCampaigns] = useState(null);
  const [wizard, setWizard] = useState(false);
  const effectiveCompany = isSuperAdmin ? companyId : "";
  const ready = !isSuperAdmin || Boolean(companyId);

  const load = useCallback(async () => {
    if (!ready) return;
    const res = await apiFetch(`/api/messaging/campaigns${qs(effectiveCompany)}`);
    if (res.ok) setCampaigns((await res.json()).campaigns || []);
  }, [ready, effectiveCompany]);

  useEffect(() => {
    setCampaigns(null);
    load();
  }, [load]);

  async function remove(c) {
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return;
    const res = await apiFetch(`/api/messaging/campaigns/${c._id}${qs(effectiveCompany)}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || "Could not delete", { type: "err" });
    toast("Campaign deleted", { type: "ok" });
    load();
  }

  const totals = (campaigns || []).reduce(
    (acc, c) => {
      acc.sent += c.stats?.sent || 0;
      acc.delivered += c.stats?.delivered || 0;
      acc.engaged += (c.stats?.read || 0) + (c.stats?.opened || 0) + (c.stats?.clicked || 0);
      acc.replied += c.stats?.replied || 0;
      return acc;
    },
    { sent: 0, delivered: 0, engaged: 0, replied: 0 }
  );

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="page-title mb-1">Campaigns</h1>
          <p className="hint mb-4">WhatsApp and email marketing to your own leads — each company sends from its own number and email address.</p>
        </div>
        {ready && tab === "campaigns" && (
          <button className="btn" onClick={() => setWizard(true)}>
            + New campaign
          </button>
        )}
      </div>

      {isSuperAdmin && <CompanySwitcher companyId={companyId} onChange={setCompanyId} editable />}

      {ready && (
        <>
          <div className="report-type-tabs">
            {[
              ["campaigns", "Campaigns"],
              ["templates", "Templates"],
              ["settings", "Senders & rules"],
            ].map(([k, l]) => (
              <button key={k} className={`report-type-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>

          {tab === "campaigns" && (
            <>
              <div className="dash-stat-grid">
                {[
                  ["Messages sent", totals.sent, "#3d5afe"],
                  ["Delivered", totals.delivered, "#0ea5e9", pct(totals.delivered, totals.sent)],
                  ["Read / opened", totals.engaged, "#8b5cf6", pct(totals.engaged, totals.sent)],
                  ["Replies", totals.replied, "#10b981", pct(totals.replied, totals.sent)],
                ].map(([label, value, color, caption]) => (
                  <div key={label} className="dash-card" style={{ "--dash-accent": color }}>
                    <div className="label">{label}</div>
                    <div className="value">{value.toLocaleString()}</div>
                    {caption && <div className="dash-card-caption">{caption} of sent</div>}
                  </div>
                ))}
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>All campaigns</h2>
                </div>
                {campaigns === null ? (
                  <div className="hint p-5">Loading…</div>
                ) : campaigns.length === 0 ? (
                  <div className="empty-state">No campaigns yet. Set up a sender under “Senders & rules”, add a template, then create your first campaign.</div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Campaign</th>
                          <th>Channel</th>
                          <th>Status</th>
                          <th>Audience</th>
                          <th>Sent</th>
                          <th>Delivered</th>
                          <th>Read / opened</th>
                          <th>Replies</th>
                          <th>Failed</th>
                          <th>When</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((c) => {
                          const s = c.stats || {};
                          const meta = STATUS_META[c.status] || STATUS_META.draft;
                          const when = c.finishedAt || c.startedAt || c.scheduledAt || c.createdAt;
                          return (
                            <tr key={c._id}>
                              <td>
                                <Link href={`/campaigns/${c._id}${qs(effectiveCompany)}`} className="font-semibold text-ink no-underline hover:underline">
                                  {c.name}
                                </Link>
                                <div className="hint m-0">{c.template?.name || "—"}</div>
                              </td>
                              <td>
                                <ChannelBadge channel={c.channel} />
                              </td>
                              <td>
                                <span className={`pill ${meta.cls}`}>{meta.label}</span>
                              </td>
                              <td>{s.audience ?? "—"}</td>
                              <td>{s.sent ?? 0}</td>
                              <td>{s.delivered ?? 0}</td>
                              <td>{(s.read || 0) + (s.opened || 0) + (s.clicked || 0)}</td>
                              <td>{s.replied ?? 0}</td>
                              <td className={s.failed ? "text-danger" : ""}>{s.failed ?? 0}</td>
                              <td className="text-muted">{when ? new Date(when).toLocaleString() : ""}</td>
                              <td>
                                <div className="flex items-center gap-1.5">
                                  <Link href={`/campaigns/${c._id}${qs(effectiveCompany)}`} className="btn-sm no-underline">
                                    {c.status === "draft" || c.status === "scheduled" ? "Open" : "Report"}
                                  </Link>
                                  {["draft", "scheduled", "failed"].includes(c.status) && (
                                    <button className="btn-sm text-danger border-danger/30 hover:bg-danger/5" onClick={() => remove(c)}>
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "templates" && (
            <div className="panel" style={{ padding: 20 }}>
              <TemplatesPanel key={effectiveCompany || "own"} companyId={effectiveCompany} />
            </div>
          )}

          {tab === "settings" && <MessagingSettingsPanel key={effectiveCompany || "own"} companyId={effectiveCompany} />}
        </>
      )}

      {wizard && (
        <CampaignWizard
          companyId={effectiveCompany}
          onClose={() => setWizard(false)}
          onDone={(id, mode) => {
            setWizard(false);
            if (mode === "now") router.push(`/campaigns/${id}${qs(effectiveCompany)}`);
            else load();
          }}
        />
      )}
    </Layout>
  );
}
