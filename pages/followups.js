import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout";
import { bucketFollowUps } from "../components/FollowUpsCard";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username } };
}

function formatDate(d) {
  return new Date(d).toLocaleDateString();
}

function FollowUpGroup({ title, items, onComplete }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <h2>
          {title} ({items.length})
        </h2>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">Nothing here.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Lead</th>
              <th>Model</th>
              <th>Phone</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.followUpId}>
                <td>{formatDate(f.date)}</td>
                <td>{f.name || "-"}</td>
                <td>{f.model || "-"}</td>
                <td>{f.phone || "-"}</td>
                <td>{f.note || "-"}</td>
                <td>
                  <button className="btn-sm" onClick={() => onComplete(f)}>
                    Mark Done
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function FollowUpsPage({ username }) {
  const [followUps, setFollowUps] = useState([]);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/followups");
    const data = await res.json();
    setFollowUps(data.followUps || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markDone(followUp) {
    await apiFetch(`/api/leads/${followUp.leadId}/followups/${followUp.followUpId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    load();
  }

  const { overdue, today, upcoming } = bucketFollowUps(followUps);

  return (
    <Layout username={username}>
      <h1 className="page-title">Follow-up Reminders</h1>
      <FollowUpGroup title="Overdue" items={overdue} onComplete={markDone} />
      <FollowUpGroup title="Due Today" items={today} onComplete={markDone} />
      <FollowUpGroup title="Upcoming" items={upcoming} onComplete={markDone} />
    </Layout>
  );
}
