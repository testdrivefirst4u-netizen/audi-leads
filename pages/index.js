import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import SyncStatusCard from "../components/SyncStatusCard";
import FollowUpsCard from "../components/FollowUpsCard";
import LeadsTable from "../components/LeadsTable";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

const POLL_INTERVAL_MS = 10000;
const PAGE_SIZE = 20;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username } };
}

export default function Dashboard({ username }) {
  const [status, setStatus] = useState(null);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [exportRange, setExportRange] = useState({ from: "", to: "" });
  const [exporting, setExporting] = useState(false);

  const fetchStatus = useCallback(async () => {
    const res = await apiFetch("/api/sync-status");
    setStatus(await res.json());
  }, []);

  const fetchLeads = useCallback(async (q, m, p) => {
    const params = new URLSearchParams({
      search: q || "",
      model: m || "",
      page: String(p || 1),
      pageSize: String(PAGE_SIZE),
    });
    const res = await apiFetch(`/api/leads?${params.toString()}`);
    const data = await res.json();
    setLeads(data.leads || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setModels(data.models || []);
  }, []);

  const fetchFollowUps = useCallback(async () => {
    const res = await apiFetch("/api/followups");
    const data = await res.json();
    setPendingFollowUps(data.followUps || []);
  }, []);

  // Initial load
  useEffect(() => {
    fetchStatus();
    fetchLeads("", "", 1);
    fetchFollowUps();
  }, [fetchStatus, fetchLeads, fetchFollowUps]);

  // Re-query when search/model/page changes (debounced for search typing)
  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(search, model, page), 250);
    return () => clearTimeout(timeout);
  }, [search, model, page, fetchLeads]);

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
  }

  function handleModelChange(value) {
    setModel(value);
    setPage(1);
  }

  // Poll for changes made by the background sync (triggered externally via
  // /api/cron/sync — no persistent server here to push updates from, so we pull instead).
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      fetchLeads(search, model, page);
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [search, model, page, fetchStatus, fetchLeads, fetchFollowUps]);

  function handleLeadUpdated(updatedLead) {
    setLeads((prev) => prev.map((l) => (l._id === updatedLead._id ? updatedLead : l)));
    fetchFollowUps();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (model) params.set("model", model);
      if (exportRange.from) params.set("from", exportRange.from);
      if (exportRange.to) params.set("to", exportRange.to);

      const res = await apiFetch(`/api/leads/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Layout username={username}>
      <h1 className="page-title">Dashboard</h1>
      <SyncStatusCard status={status} />
      <div style={{ marginBottom: 24 }}>
        <FollowUpsCard followUps={pendingFollowUps} />
      </div>
      <LeadsTable
        leads={leads}
        search={search}
        onSearchChange={handleSearchChange}
        model={model}
        onModelChange={handleModelChange}
        models={models}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        exportRange={exportRange}
        onExportRangeChange={setExportRange}
        onExport={handleExport}
        exporting={exporting}
        onLeadUpdated={handleLeadUpdated}
      />
    </Layout>
  );
}
