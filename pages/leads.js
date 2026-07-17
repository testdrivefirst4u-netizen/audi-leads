import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import LeadsTable from "../components/LeadsTable";
import CompanySwitcher from "../components/CompanySwitcher";
import { useToast } from "../components/ToastProvider";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";

// Polls our own database only (never Google Sheets directly), so a fast
// interval is cheap — new leads that the separate Sheets->DB sync has
// already ingested show up here within a few seconds, no page refresh.
const POLL_INTERVAL_MS = 3000;
const PAGE_SIZE = 20;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Super admin isn't redirected away anymore — they get a read-only,
  // company-picker-driven view of this same page (see CompanySwitcher).
  if (session.role === "super_admin") {
    return { props: { username: session.username, role: "super_admin", initialHot: false } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return {
    props: {
      username: session.username,
      role: session.role || "admin",
      initialHot: context.query.hot === "true",
      ...branding,
    },
  };
}

// Turns an export date-range preset into concrete from/to date strings.
function resolveExportRange(preset, custom) {
  if (preset === "custom") return { from: custom.from, to: custom.to };
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  }
  if (preset === "yesterday") {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    return { from: yesterday, to: yesterday };
  }

  const months = { "1m": 1, "2m": 2, "3m": 3 }[preset] || 1;
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  const toISODate = (d) => d.toISOString().slice(0, 10);
  return { from: toISODate(from), to: toISODate(to) };
}

export default function LeadsPage({ username, role, initialHot, companyName, companyLogoUrl, companyBrandColor }) {
  const toast = useToast();
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [followUpFilter, setFollowUpFilter] = useState("");
  const [followUpTabs, setFollowUpTabs] = useState({ overdue: 0, today: 0, upcoming: 0, completed: 0 });
  const [hotOnly, setHotOnly] = useState(!!initialHot);
  const [sortBy, setSortBy] = useState("sheetCreatedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [models, setModels] = useState([]);
  const [sources, setSources] = useState([]);
  const [agents, setAgents] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [exportPreset, setExportPreset] = useState("all");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(
    (filters) => {
      if (isSuperAdminView && !filters.viewCompanyId) return Promise.resolve();
      const { from, to } = resolveExportRange(filters.datePreset, filters.customRange);
      const params = new URLSearchParams({
        search: filters.search || "",
        model: filters.model || "",
        status: filters.status || "",
        agent: filters.agentFilter || "",
        location: filters.locationFilter || "",
        source: filters.sourceFilter || "",
        followUpFilter: filters.followUpFilter || "",
        hot: filters.hotOnly ? "true" : "",
        from: from || "",
        to: to || "",
        sortBy: filters.sortBy || "updatedAt",
        sortDir: filters.sortDir || "desc",
        page: String(filters.page || 1),
        pageSize: String(PAGE_SIZE),
      });
      if (isSuperAdminView) params.set("companyId", filters.viewCompanyId);
      return apiFetch(`/api/leads?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          setLeads(data.leads || []);
          setTotal(data.total || 0);
          setTotalPages(data.totalPages || 1);
          setModels(data.models || []);
          setSources(data.sources || []);
          setAgents(data.agents || []);
          setFollowUpTabs(data.followUpTabs || { overdue: 0, today: 0, upcoming: 0, completed: 0 });
        })
        .finally(() => setLoading(false));
    },
    [isSuperAdminView]
  );

  const filters = {
    search,
    model,
    status,
    agentFilter,
    locationFilter,
    sourceFilter,
    followUpFilter,
    hotOnly,
    sortBy,
    sortDir,
    page,
    datePreset: exportPreset,
    customRange,
    viewCompanyId,
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(filters), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, model, status, agentFilter, locationFilter, sourceFilter, followUpFilter, hotOnly, sortBy, sortDir, page, exportPreset, customRange, viewCompanyId, fetchLeads]);

  useEffect(() => {
    const interval = setInterval(() => fetchLeads(filters), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, model, status, agentFilter, locationFilter, sourceFilter, followUpFilter, hotOnly, sortBy, sortDir, page, exportPreset, customRange, viewCompanyId, fetchLeads]);

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

  function handleAgentFilterChange(value) {
    setAgentFilter(value);
    setPage(1);
  }

  function handleLocationFilterChange(value) {
    setLocationFilter(value);
    setPage(1);
  }

  function handleSourceFilterChange(value) {
    setSourceFilter(value);
    setPage(1);
  }

  function handleFollowUpFilterChange(value) {
    setFollowUpFilter((prev) => (prev === value ? "" : value)); // click active tab again to clear
    setPage(1);
  }

  function handleViewCompanyChange(value) {
    setViewCompanyId(value);
    setPage(1);
  }

  async function handleReassign(leadId, agentId) {
    if (isSuperAdminView) return undefined; // read-only view — no mutations
    const res = await apiFetch(`/api/leads/${leadId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to reassign lead", { type: "err" });
      return undefined;
    }
    const data = await res.json();
    handleLeadUpdated(data.lead);
    toast(agentId ? "Lead reassigned" : "Lead unassigned");
    return data.lead;
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
      if (agentFilter) params.set("agent", agentFilter);
      if (locationFilter) params.set("location", locationFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (isSuperAdminView) params.set("companyId", viewCompanyId);

      const res = await apiFetch(`/api/leads/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Leads</h1>
      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={handleViewCompanyChange} />}
      <LeadsTable
        leads={leads}
        loading={loading}
        search={search}
        onSearchChange={handleSearchChange}
        model={model}
        onModelChange={handleModelChange}
        status={status}
        onStatusChange={handleStatusChange}
        agentFilter={agentFilter}
        onAgentFilterChange={handleAgentFilterChange}
        locationFilter={locationFilter}
        onLocationFilterChange={handleLocationFilterChange}
        sourceFilter={sourceFilter}
        onSourceFilterChange={handleSourceFilterChange}
        sources={sources}
        followUpFilter={followUpFilter}
        onFollowUpFilterChange={handleFollowUpFilterChange}
        followUpTabs={followUpTabs}
        agents={agents}
        role={isSuperAdminView ? "admin" : role}
        readOnly={isSuperAdminView}
        onReassign={handleReassign}
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
