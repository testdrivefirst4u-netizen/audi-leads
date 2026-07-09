import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import SyncStatusCard from "../components/SyncStatusCard";
import FollowUpsCard from "../components/FollowUpsCard";
import DueTodayBanner from "../components/DueTodayBanner";
import PipelineStats from "../components/PipelineStats";
import LeadsTrendChart from "../components/LeadsTrendChart";
import ModelBarChart from "../components/ModelBarChart";
import LeadStatsPanel from "../components/LeadStatsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

const POLL_INTERVAL_MS = 10000;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username } };
}

export default function Dashboard({ username }) {
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);

  const fetchStatus = useCallback(async () => {
    const res = await apiFetch("/api/sync-status");
    setStatus(await res.json());
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await apiFetch("/api/stats");
    setStats(await res.json());
  }, []);

  const fetchFollowUps = useCallback(async () => {
    const res = await apiFetch("/api/followups");
    const data = await res.json();
    setPendingFollowUps(data.followUps || []);
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStats();
    fetchFollowUps();
  }, [fetchStatus, fetchStats, fetchFollowUps]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      fetchStats();
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchStats, fetchFollowUps]);

  return (
    <Layout username={username}>
      <h1 className="page-title">Dashboard</h1>

      <DueTodayBanner followUps={pendingFollowUps} />

      <SyncStatusCard status={status} />

      <h2 className="section-title">Lead Pipeline</h2>
      <PipelineStats pipeline={stats?.pipeline} />

      <div className="chart-row">
        <div className="chart-section">
          <h3>Leads per day (last 30 days)</h3>
          <LeadsTrendChart trend={stats?.trend} />
        </div>
        <div className="chart-section">
          <h3>Leads by Model</h3>
          <ModelBarChart models={stats?.models} />
        </div>
      </div>

      <LeadStatsPanel stats={stats} />

      <FollowUpsCard followUps={pendingFollowUps} />
    </Layout>
  );
}
