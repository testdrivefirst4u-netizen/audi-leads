import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import { bucketFollowUps } from "../components/FollowUpsCard";
import PipelineStats from "../components/PipelineStats";
import LeadsTrendChart from "../components/LeadsTrendChart";
import ModelBarChart from "../components/ModelBarChart";
import StatusPieChart from "../components/StatusPieChart";
import BucketPieChart from "../components/BucketPieChart";
import BarListChart from "../components/BarListChart";
import Panel from "../components/dashboard/Panel";
import KpiCard from "../components/dashboard/KpiCard";
import DashToolbar from "../components/dashboard/DashToolbar";
import TodayTasks from "../components/dashboard/TodayTasks";
import StageFunnel, { canDrawFunnel } from "../components/dashboard/StageFunnel";
import { Conversion, AgentLeaderboard } from "../components/dashboard/Insights";
import { UsersIcon, FireIcon, BellIcon, CalendarIcon, CarIcon, ReportIcon } from "../components/icons";
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

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const pipelineCount = (stats, label) => stats?.pipeline?.find((p) => p.label === label)?.count ?? 0;

/**
 * The Dashboard, laid out like a CRM home dashboard (Zoho-style): a toolbar
 * with the period and refresh, a strip of KPI components, then a 12-column
 * grid of panels — the day's work (trend + today's tasks) first, then the
 * pipeline and conversion, then breakdowns (status, source, model), the team
 * (agent leaderboard, buckets, calls) and campaign/exchange/showroom mixes.
 *
 * The KPI strip is always live (today / all-time); the period in the toolbar
 * applies to the charts below it, as before (/api/stats?month=).
 */
export default function Dashboard({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [stats, setStats] = useState(null);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [month, setMonth] = useState(""); // "" = all time
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const fetchStats = useCallback(
    async (m) => {
      if (isSuperAdminView && !viewCompanyId) return;
      const params = new URLSearchParams();
      if (m) params.set("month", m);
      if (isSuperAdminView) params.set("companyId", viewCompanyId);
      const res = await apiFetch(`/api/stats${params.toString() ? `?${params.toString()}` : ""}`);
      setStats(await res.json());
      setUpdatedAt(new Date());
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
      if (document.hidden) return; // nobody's looking at a background tab
      fetchStats(month);
      fetchFollowUps();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats, fetchFollowUps, month]);

  function refreshNow() {
    setRefreshing(true);
    Promise.all([fetchStats(month), fetchFollowUps()]).finally(() => setRefreshing(false));
  }

  const { overdue, today } = bucketFollowUps(pendingFollowUps);
  const trend = (stats?.trend || []).map((t) => t.count);
  const booked = pipelineCount(stats, "Booking") + pipelineCount(stats, "Retail (Converted)");
  const period = month ? monthLabel(month) : "All time";
  const exchangeRows = (stats?.exchange || []).map((row) => (row.label === "Not Filled" ? { ...row, muted: true } : row));
  const chart = (node, h = 220) => (loading ? <Skeleton height={h} /> : node);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} />}

      <DashToolbar username={username} month={month} onMonthChange={setMonth} updatedAt={updatedAt} onRefresh={refreshNow} refreshing={refreshing} />

      {/* KPI components — always live */}
      <div className="dash2-kpis">
        <KpiCard label="Total leads" icon={UsersIcon} value={stats?.duplicateDetection?.totalEnquiries} caption={`${stats?.duplicateDetection?.uniqueLeads ?? 0} unique customers`} spark={trend} href="/leads" loading={loading} />
        {/* repeat enquiries from customers already in the CRM (same as the old "Duplicate Leads" card); today / yesterday in the caption */}
        <KpiCard label="Duplicates" icon={ReportIcon} value={stats?.duplicateDetection?.duplicateEnquiries} caption={`+${stats?.duplicatesToday ?? 0} today · ${stats?.duplicatesYesterday ?? 0} yesterday`} loading={loading} />
        <KpiCard label="New today" icon={CalendarIcon} value={stats?.newLeadsToday} delta={stats ? (stats.newLeadsToday ?? 0) - (stats.newLeadsYesterday ?? 0) : null} deltaLabel="vs yesterday" loading={loading} />
        <KpiCard label="Hot leads" icon={FireIcon} value={stats?.hotCount} caption="not contacted yet" href="/leads?hot=true" tone="alert" loading={loading} />
        <KpiCard label="Follow-ups" icon={BellIcon} value={overdue.length + today.length} caption={overdue.length ? `due today · ${overdue.length} overdue` : "due today · none overdue"} href="/followups" tone={overdue.length ? "alert" : undefined} loading={loading} />
        <KpiCard label="Booked" icon={CarIcon} value={booked} caption={`booking or sold · ${period.toLowerCase()}`} loading={loading} />
      </div>

      <div className="dash2-grid">
        <Panel title={month ? `Leads per day · ${period}` : "Leads per day · last 30 days"} span={8}>
          {chart(<LeadsTrendChart trend={stats?.trend} />, 240)}
        </Panel>
        <Panel title="Today's tasks" note={`${overdue.length} overdue · ${today.length} due today`} href="/followups" linkLabel="All follow-ups" span={4}>
          <TodayTasks followUps={pendingFollowUps} loading={loading} />
        </Panel>

        <Panel title="Pipeline" note={`${period} · how far leads get`} href="/leads" span={6}>
          {/* the funnel needs the standard stages; a company with its own statuses keeps the bar chart */}
          {chart(canDrawFunnel(stats?.pipeline) ? <StageFunnel pipeline={stats?.pipeline} /> : <PipelineStats pipeline={stats?.pipeline} />, 300)}
        </Panel>
        {/* Conversion and calls stacked beside the (taller) pipeline chart */}
        <div className="dash2-stack dash2-span-6">
          <Panel title="Conversion" note={`${period} · from where each lead stands now`} span={12}>
            <Conversion pipeline={stats?.pipeline} loading={loading} />
          </Panel>
          <Panel title="Calls made" note={period} span={12}>
            {loading ? (
              <Skeleton height={56} />
            ) : (
              <div className="flex items-end gap-3">
                <div className="text-[36px] font-bold text-ink leading-none">{stats?.totalCalls ?? 0}</div>
                <div className="pb-1 text-[12.5px] text-muted">call attempts logged across every lead</div>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Status mix" note={period} span={4}>
          {chart(<StatusPieChart pipeline={stats?.pipeline} />)}
        </Panel>
        <Panel title="Lead sources" note={period} span={4}>
          {chart(<BarListChart data={stats?.sources} />)}
        </Panel>
        <Panel title="Leads by model" note={period} span={4}>
          {chart(<ModelBarChart models={stats?.models} />)}
        </Panel>

        {!isSuperAdminView && role !== "agent" && (
          <Panel title="Agent leaderboard" note={`${period} · ranked by bookings`} href="/agents" linkLabel="Agents" span={8}>
            <AgentLeaderboard agents={stats?.agentBoard} loading={loading} />
          </Panel>
        )}
        <Panel title="Lead buckets" note={period} span={role === "agent" || isSuperAdminView ? 12 : 4}>
          {chart(<BucketPieChart buckets={stats?.buckets} />)}
        </Panel>

        {(loading || stats?.campaigns?.length > 0) && (
          <Panel title="Leads by campaign" note={period} span={6}>
            {chart(<BarListChart data={stats?.campaigns} />)}
          </Panel>
        )}
        <Panel title="Exchange plan" note={period} span={3}>
          {chart(<BarListChart data={exchangeRows} emptyText="No data" />, 160)}
        </Panel>
        <Panel title="Showroom" note={period} span={3}>
          {chart(<BarListChart data={stats?.showroom} emptyText="No showroom data in this sheet" />, 160)}
        </Panel>
      </div>
    </Layout>
  );
}
