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
import BucketPieChart from "../components/BucketPieChart";
import BarListChart from "../components/BarListChart";
import LeadStatsPanel from "../components/LeadStatsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";


// The underlying data only actually changes as often as the sync runs (once
// a day on Vercel, per vercel.json's cron) — 20s still feels responsive for
// a dashboard while cutting invocation volume ~7x versus the previous 3s.
const POLL_INTERVAL_MS = 20000;

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

// "Today's Leads" only has a meaningful comparison point against yesterday —
// both fields already come back from /api/stats with no backend change.
function TodayDelta({ today, yesterday }) {
  if (today == null || yesterday == null) return null;
  const diff = today - yesterday;
  if (diff === 0) {
    return <div className="dash-card-delta dash-card-delta--flat">– same as yesterday</div>;
  }
  const isUp = diff > 0;
  return (
    <div className={`dash-card-delta ${isUp ? "dash-card-delta--up" : "dash-card-delta--down"}`}>
      {isUp ? "▲" : "▼"} {Math.abs(diff)} vs yesterday
    </div>
  );
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
      <h1 className="page-title mb-1">Dashboard</h1>
      <p className="hint mb-5">Live overview of your pipeline, leads, and follow-ups.</p>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} />}

      {loading ? (
        <Skeleton height={44} className="mb-5" />
      ) : (
        <DueTodayBanner followUps={pendingFollowUps} />
      )}
      {loading ? <Skeleton height={44} className="mb-5" /> : <HotLeadsCard count={stats?.hotCount} />}

      <h2 className="section-title">Lead Pipeline Dashboard</h2>
      {month && (
        <p className="hint mb-3" style={{ marginTop: "-8px" }}>
          These 5 stats are always all-time totals — they don't change with the Month filter below. Only the charts further down reflect {monthLabel(month)}.
        </p>
      )}
      <div className="dash-stat-grid">
        <div className="dash-card" style={{ "--dash-accent": "rgb(var(--accent-rgb))" }}>
          <div className="label">Total Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.totalEnquiries ?? 0}</div>
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#2a78d6" }}>
          <div className="label">Unique Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.uniqueLeads ?? 0}</div>
          {!loading && stats?.newLeadsToday > 0 && <div className="dash-card-caption">+{stats.newLeadsToday} today</div>}
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#eda100" }}>
          <div className="label">Duplicate Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicateDetection?.duplicateEnquiries ?? 0}</div>
          {!loading && stats?.duplicatesToday > 0 && <div className="dash-card-caption">+{stats.duplicatesToday} today</div>}
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#1baf7a" }}>
          <div className="label">Today's Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.newLeadsToday ?? 0}</div>
          {!loading && <TodayDelta today={stats?.newLeadsToday} yesterday={stats?.newLeadsYesterday} />}
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#b45309" }}>
          <div className="label">Today's Duplicates</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.duplicatesToday ?? 0}</div>
          {!loading && (
            <div className="dash-card-caption">
              repeat enquiries today · {stats?.enquiriesToday ?? 0} total enquir{(stats?.enquiriesToday ?? 0) === 1 ? "y" : "ies"} received
            </div>
          )}
        </div>
        <div className="dash-card" style={{ "--dash-accent": "#94a3b8" }}>
          <div className="label">Yesterday's Leads</div>
          <div className="value">{loading ? <Skeleton width={60} /> : stats?.newLeadsYesterday ?? 0}</div>
          {!loading && stats?.duplicatesYesterday > 0 && <div className="dash-card-caption">+{stats.duplicatesYesterday} duplicates</div>}
        </div>
      </div>

      <div className="chart-row-4">
        <div className="dash-panel mb-0">
          <h3>Lead Status Distribution</h3>
          {loading ? <Skeleton height={200} /> : <StatusPieChart pipeline={stats?.pipeline} />}
        </div>
        <div className="dash-panel mb-0">
          <h3>Pipeline Funnel</h3>
          {loading ? <Skeleton height={200} /> : <PipelineStats pipeline={stats?.pipeline} />}
        </div>
        <div className="dash-panel mb-0">
          <h3>Lead Source Distribution</h3>
          {loading ? <Skeleton height={200} /> : <BarListChart data={stats?.sources} />}
        </div>
        <div className="dash-panel mb-0">
          <h3>Lead Bucket Distribution</h3>
          {loading ? <Skeleton height={200} /> : <BucketPieChart buckets={stats?.buckets} />}
        </div>
      </div>

      {(loading || stats?.campaigns?.length > 0) && (
        <div className="dash-panel">
          <h3>Leads by Campaign</h3>
          {loading ? <Skeleton height={200} /> : <BarListChart data={stats?.campaigns} />}
        </div>
      )}

      <div className="dash-panel flex items-center gap-3 flex-wrap">
        <label className="toolbar-label m-0">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={currentMonth()} />
        {month && (
          <button className="btn-sm" onClick={() => setMonth("")}>
            All Time
          </button>
        )}
        <span className="hint m-0">{month ? `Showing ${monthLabel(month)}` : "Showing all time"}</span>
      </div>

      <div className="chart-row">
        <div className="dash-panel mb-0">
          <h3>Leads per day {month ? `(${monthLabel(month)})` : "(last 30 days)"}</h3>
          {loading ? <Skeleton height={220} /> : <LeadsTrendChart trend={stats?.trend} />}
        </div>
        <div className="dash-panel mb-0">
          <h3>Leads by Model</h3>
          {loading ? <Skeleton height={220} /> : <ModelBarChart models={stats?.models} />}
        </div>
      </div>

      {loading ? <Skeleton height={140} className="mb-6" /> : <LeadStatsPanel stats={stats} />}

      {loading ? <Skeleton height={80} /> : <FollowUpsCard followUps={pendingFollowUps} />}
    </Layout>
  );
}
