import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import SyncStatusCard from "../components/SyncStatusCard";
import FollowUpsCard from "../components/FollowUpsCard";
import LeadsTable from "../components/LeadsTable";
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
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [pendingFollowUps, setPendingFollowUps] = useState([]);

  const fetchStatus = useCallback(async () => {
    const res = await apiFetch("/api/sync-status");
    setStatus(await res.json());
  }, []);

  const fetchLeads = useCallback(async (q) => {
    const res = await apiFetch(`/api/leads?search=${encodeURIComponent(q || "")}`);
    const data = await res.json();
    setLeads(data.leads || []);
  }, []);

  const fetchFollowUps = useCallback(async () => {
    const res = await apiFetch("/api/followups");
    const data = await res.json();
    setPendingFollowUps(data.followUps || []);
  }, []);

  // Initial load
  useEffect(() => {
    fetchStatus();
    fetchLeads("");
    fetchFollowUps();
  }, [fetchStatus, fetchLeads, fetchFollowUps]);

  // Re-query when the search box changes
  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(search), 250);
    return () => clearTimeout(timeout);
  }, [search, fetchLeads]);

  // Poll for changes made by the background sync (triggered externally via
  // /api/cron/sync — no persistent server here to push updates from, so we pull instead).
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      fetchLeads(search);
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [search, fetchStatus, fetchLeads, fetchFollowUps]);

  function handleLeadUpdated(updatedLead) {
    setLeads((prev) => prev.map((l) => (l._id === updatedLead._id ? updatedLead : l)));
    fetchFollowUps();
  }

  return (
    <Layout username={username}>
      <h1 className="page-title">Dashboard</h1>
      <SyncStatusCard status={status} />
      <div style={{ marginBottom: 24 }}>
        <FollowUpsCard followUps={pendingFollowUps} />
      </div>
      <LeadsTable leads={leads} search={search} onSearchChange={setSearch} onLeadUpdated={handleLeadUpdated} />
    </Layout>
  );
}
