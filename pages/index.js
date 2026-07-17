import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import FollowUpsCard from "../components/FollowUpsCard";
import DueTodayBanner from "../components/DueTodayBanner";
import HotLeadsCard from "../components/HotLeadsCard";
import PipelineStats from "../components/PipelineStats";
import LeadsTrendChart from "../components/LeadsTrendChart";
import ModelBarChart from "../components/ModelBarChart";
import StatusPieChart from "../components/StatusPieChart";
import VerticalBarChart from "../components/VerticalBarChart";
import LeadStatsPanel from "../components/LeadStatsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";


const POLL_INTERVAL_MS = 3000;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Super admin isn't redirected away anymore — they get a read-only,
  // company-picker-driven view of this same dashboard.
  if (session.role === "super_admin") {
    return { props: { username: session.username, role: "super_admin" } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function Dashboard({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [stats, setStats] = useState(null);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [month, setMonth] = useState(""); // "" = all time
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(
    async (m) => {
      if (isSuperAdminView && !viewCompanyId) return;
      const params = new URLSearchParams();
      if (m) params.set("month", m);
      if (isSuperAdminView) params.set("companyId", viewCompanyId);
      const res = await apiFetch(`/api/stats${params.toString() ? `?${params.toString()}` : ""}`);
      setStats(await res.json());
    },
    [isSuperAdminView, viewCompanyId]
  );

  const fetchFollowUps = useCallback(async () => {
    if (isSuperAdminView && !viewCompanyId) return;
    const params = new URLSearchParams();
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    const res = await apiFetch(`/api/followups${params.toString() ? `?${params.toString()}` : ""}`);
    const data = await res.json();
    setPendingFollowUps(data.followUps || []);
  }, [isSuperAdminView, viewCompanyId]);

  useEffect(() => {
    Promise.all([fetchStats(month), fetchFollowUps()]).finally(() => setLoading(false));
  }, [fetchStats, fetchFollowUps, month]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats(month);
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats, fetchFollowUps, month]);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Dashboard</h1>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} />}

      {loading ? (
        <Skeleton height={44} className="mb-5" />
      ) : (
        <DueTodayBanner followUps={pendingFollowUps} />
      )}
      {loading ? <Skeleton height={44} className="mb-5" /> : <HotLeadsCard count={stats?.hotCount} />}

      <h2 className="section-title">Lead Pipeline Dashboard</h2>
      <div className="status-grid">
        <div className="card">
          <div className="label">Total Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.totalEnquiries ?? 0}</div>
        </div>
        <div className="card">
          <div className="label">Unique Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.uniqueLeads ?? 0}</div>
        </div>
        <div className="card">
          <div className="label">Duplicate Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.duplicateEnquiries ?? 0}</div>
          {/* <div className="hint">Leads with 1+ repeat enquiry</div> */}
        </div>
        {/* <div className="card">
          <div className="label">Repeat Submissions</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.duplicateEnquiries ?? 0}</div>
           <div className="hint">Unique + this = Total Leads</div> 
        </div> */}
        <div className="card">
          <div className="label">Today's Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.newLeadsToday ?? 0}</div>
        </div>
        <div className="card">
          <div className="label">Yesterday's Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.newLeadsYesterday ?? 0}</div>
        </div>
      </div>

      <div className="chart-row-3">
        <div className="chart-section">
          <h3>Lead Status Distribution</h3>
          {loading ? <Skeleton height={200} /> : <StatusPieChart pipeline={stats?.pipeline} />}
        </div>
        <div className="chart-section">
          <h3>Pipeline Funnel</h3>
          {loading ? <Skeleton height={200} /> : <PipelineStats pipeline={stats?.pipeline} />}
        </div>
        <div className="chart-section">
          <h3>Lead Source Distribution</h3>
          {loading ? <Skeleton height={200} /> : <VerticalBarChart data={stats?.sources} />}
        </div>
      </div>

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

      <div className="chart-row">
        <div className="chart-section">
          <h3>Leads per day {month ? `(${monthLabel(month)})` : "(last 30 days)"}</h3>
          {loading ? <Skeleton height={220} /> : <LeadsTrendChart trend={stats?.trend} />}
        </div>
        <div className="chart-section">
          <h3>Leads by Model</h3>
          {loading ? <Skeleton height={220} /> : <ModelBarChart models={stats?.models} />}
        </div>
      </div>

      {loading ? <Skeleton height={140} className="mb-6" /> : <LeadStatsPanel stats={stats} />}

      {loading ? <Skeleton height={80} /> : <FollowUpsCard followUps={pendingFollowUps} />}
    </Layout>
  );
}
