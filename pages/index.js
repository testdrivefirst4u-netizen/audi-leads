import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import SyncStatusCard from "../components/SyncStatusCard";
import FollowUpsCard from "../components/FollowUpsCard";
import DueTodayBanner from "../components/DueTodayBanner";
import HotLeadsCard from "../components/HotLeadsCard";
import PipelineStats from "../components/PipelineStats";
import LeadsTrendChart from "../components/LeadsTrendChart";
import ModelBarChart from "../components/ModelBarChart";
import LeadStatsPanel from "../components/LeadStatsPanel";
import DuplicateStatsPanel from "../components/DuplicateStatsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

const POLL_INTERVAL_MS = 10000;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username, role: session.role || "admin" } };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function Dashboard({ username, role }) {
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [month, setMonth] = useState(""); // "" = all time

  const fetchStatus = useCallback(async () => {
    if (role !== "admin") return;
    const res = await apiFetch("/api/sync-status");
    setStatus(await res.json());
  }, [role]);

  const fetchStats = useCallback(async (m) => {
    const res = await apiFetch(`/api/stats${m ? `?month=${m}` : ""}`);
    setStats(await res.json());
  }, []);

  const fetchFollowUps = useCallback(async () => {
    const res = await apiFetch("/api/followups");
    const data = await res.json();
    setPendingFollowUps(data.followUps || []);
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStats(month);
    fetchFollowUps();
  }, [fetchStatus, fetchStats, fetchFollowUps, month]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      fetchStats(month);
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchStats, fetchFollowUps, month]);

  return (
    <Layout username={username} role={role}>
      <h1 className="page-title">Dashboard</h1>

      <DueTodayBanner followUps={pendingFollowUps} />
      <HotLeadsCard count={stats?.hotCount} />

      {role === "admin" && <SyncStatusCard status={status} />}

      <div className="dashboard-month-filter">
        <label className="toolbar-label">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={currentMonth()} />
        {month && (
          <button className="btn-sm" onClick={() => setMonth("")}>
            All Time
          </button>
        )}
        <span className="hint">{month ? `Showing ${monthLabel(month)}` : "Showing all time"}</span>
      </div>

      <h2 className="section-title">Lead Pipeline</h2>
      <PipelineStats pipeline={stats?.pipeline} />

      <div className="chart-row">
        <div className="chart-section">
          <h3>Leads per day {month ? `(${monthLabel(month)})` : "(last 30 days)"}</h3>
          <LeadsTrendChart trend={stats?.trend} />
        </div>
        <div className="chart-section">
          <h3>Leads by Model</h3>
          <ModelBarChart models={stats?.models} />
        </div>
      </div>

      <LeadStatsPanel stats={stats} />

      <DuplicateStatsPanel stats={stats} />

      <FollowUpsCard followUps={pendingFollowUps} />
    </Layout>
  );
}
