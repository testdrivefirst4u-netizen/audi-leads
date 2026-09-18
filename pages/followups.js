import { useCallback, useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";
import Link from "next/link";
import Layout from "../components/Layout";
import { bucketFollowUps } from "../components/FollowUpsCard";
import { useToast } from "../components/ToastProvider";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role === "super_admin") return { redirect: { destination: "/companies", permanent: false } };
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

function formatDate(d) {
  return new Date(d).toLocaleDateString();
}

// Follow-ups are actioned from the lead itself (Leads → Overdue / Due Today
// tabs → Manage → Mark done / Snooze), so this page is a reminder list
// only: each row links to the lead rather than duplicating those controls.
function FollowUpGroup({ title, items, onReopen, numbered, loading }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <h2>
          {title} ({loading ? "-" : items.length})
        </h2>
      </div>
      {loading ? (
        <div className="p-5">
          <Skeleton count={3} height={30} className="mb-2" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">Nothing here.</div>
      ) : (
        <table>
          <thead>
            <tr>
              {numbered && <th>#</th>}
              <th>Date</th>
              <th>Lead</th>
              <th>Model</th>
              <th>Phone</th>
              <th>Note</th>
              {onReopen && <th>Completed</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((f, i) => (
              <tr key={f.followUpId}>
                {numbered && <td>{i + 1}</td>}
                <td>{formatDate(f.date)}</td>
                <td>{f.name || "-"}</td>
                <td>{f.model || "-"}</td>
                <td>{f.phone || "-"}</td>
                <td>{f.note || "-"}</td>
                {onReopen && (
                  <td>
                    {f.completedAt ? formatDate(f.completedAt) : "-"}{" "}
                    <button className="btn-sm" onClick={() => onReopen(f)}>
                      Reopen
                    </button>
                  </td>
                )}
                <td>
                  <Link href={`/leads?q=${encodeURIComponent(f.phone || f.name || "")}`} className="btn-sm inline-block">
                    Open lead
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function FollowUpsPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const toast = useToast();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/followups?all=true");
    const data = await res.json();
    setFollowUps(data.followUps || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reopen(followUp) {
    const res = await apiFetch(`/api/leads/${followUp.leadId}/followups/${followUp.followUpId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: false }),
    });
    toast(res.ok ? "Follow-up reopened" : "Failed to reopen follow-up", { type: res.ok ? "ok" : "err" });
    load();
  }

  const pending = followUps.filter((f) => !f.completed);
  const completed = [...followUps.filter((f) => f.completed)].sort(
    (a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date)
  );
  const { overdue, today, upcoming } = bucketFollowUps(pending);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Follow-up Reminders</h1>
      <FollowUpGroup title="Overdue" items={overdue} loading={loading} />
      <FollowUpGroup title="Due Today" items={today} loading={loading} />
      <FollowUpGroup title="Upcoming" items={upcoming} loading={loading} />
      <FollowUpGroup title="Completed History" items={completed} onReopen={reopen} numbered loading={loading} />
    </Layout>
  );
}
