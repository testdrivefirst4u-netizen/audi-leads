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
  return { props: { username: session.username, initialHot: context.query.hot === "true" } };
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

export default function LeadsPage({ username, initialHot }) {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [hotOnly, setHotOnly] = useState(!!initialHot);
  const [sortBy, setSortBy] = useState("sheetCreatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [models, setModels] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [exportPreset, setExportPreset] = useState("all");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [exporting, setExporting] = useState(false);

  const fetchLeads = useCallback((filters) => {
    const { from, to } = resolveExportRange(filters.datePreset, filters.customRange);
    const params = new URLSearchParams({
      search: filters.search || "",
      model: filters.model || "",
      status: filters.status || "",
      hot: filters.hotOnly ? "true" : "",
      from: from || "",
      to: to || "",
      sortBy: filters.sortBy || "updatedAt",
      sortDir: filters.sortDir || "desc",
      page: String(filters.page || 1),
      pageSize: String(PAGE_SIZE),
    });
    return apiFetch(`/api/leads?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setLeads(data.leads || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setModels(data.models || []);
      });
  }, []);

  const filters = { search, model, status, hotOnly, sortBy, sortDir, page, datePreset: exportPreset, customRange };

  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(filters), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, model, status, hotOnly, sortBy, sortDir, page, exportPreset, customRange, fetchLeads]);

  useEffect(() => {
    const interval = setInterval(() => fetchLeads(filters), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, model, status, hotOnly, sortBy, sortDir, page, exportPreset, customRange, fetchLeads]);

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

  function handleHotOnlyChange(value) {
    setHotOnly(value);
    setPage(1);
  }

  function handleExportPresetChange(value) {
    setExportPreset(value);
    setPage(1);
  }

  function handleCustomRangeChange(value) {
    setCustomRange(value);
    setPage(1);
  }

  function handleSortChange(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
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
        hotOnly={hotOnly}
        onHotOnlyChange={handleHotOnlyChange}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        models={models}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        exportPreset={exportPreset}
        onExportPresetChange={handleExportPresetChange}
        customRange={customRange}
        onCustomRangeChange={handleCustomRangeChange}
        onExport={handleExport}
        exporting={exporting}
        onLeadUpdated={handleLeadUpdated}
      />
    </Layout>
  );
}
