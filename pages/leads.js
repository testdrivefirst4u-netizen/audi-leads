import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
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

// Turns an export date-range preset into concrete from/to date strings.
function resolveExportRange(preset, custom) {
  if (preset === "custom") return { from: custom.from, to: custom.to };
  if (preset === "all") return { from: "", to: "" };

  const months = { "1m": 1, "2m": 2, "3m": 3 }[preset] || 1;
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  const toISODate = (d) => d.toISOString().slice(0, 10);
  return { from: toISODate(from), to: toISODate(to) };
}

export default function LeadsPage({ username }) {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [models, setModels] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [exportPreset, setExportPreset] = useState("all");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [exporting, setExporting] = useState(false);

  const fetchLeads = useCallback(async (q, m, s, p) => {
    const params = new URLSearchParams({
      search: q || "",
      model: m || "",
      status: s || "",
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

  useEffect(() => {
    fetchLeads("", "", "", 1);
  }, [fetchLeads]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(search, model, status, page), 250);
    return () => clearTimeout(timeout);
  }, [search, model, status, page, fetchLeads]);

  useEffect(() => {
    const interval = setInterval(() => fetchLeads(search, model, status, page), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [search, model, status, page, fetchLeads]);

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
  }

  function handleModelChange(value) {
    setModel(value);
    setPage(1);
  }

  function handleStatusChange(value) {
    setStatus(value);
    setPage(1);
  }

  function handleLeadUpdated(updatedLead) {
    setLeads((prev) => prev.map((l) => (l._id === updatedLead._id ? updatedLead : l)));
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { from, to } = resolveExportRange(exportPreset, customRange);
      const params = new URLSearchParams();
      if (model) params.set("model", model);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

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
      <h1 className="page-title">Leads</h1>
      <LeadsTable
        leads={leads}
        search={search}
        onSearchChange={handleSearchChange}
        model={model}
        onModelChange={handleModelChange}
        status={status}
        onStatusChange={handleStatusChange}
        models={models}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        exportPreset={exportPreset}
        onExportPresetChange={setExportPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        onExport={handleExport}
        exporting={exporting}
        onLeadUpdated={handleLeadUpdated}
      />
    </Layout>
  );
}
