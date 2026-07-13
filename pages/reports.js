import { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import ModelBarChart from "../components/ModelBarChart";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username } };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function BarList({ rows, emptyText }) {
  if (!rows || rows.length === 0) {
    return <div className="empty-state" style={{ padding: "20px 0" }}>{emptyText}</div>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span className="bar-label" title={row.label}>
            {row.label}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
          <span className="bar-count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage({ username }) {
  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState(null);
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async (m) => {
    const res = await apiFetch(`/api/reports?month=${m}`);
    setReport(await res.json());
  }, []);

  useEffect(() => {
    fetchReport(month);
  }, [month, fetchReport]);

  async function handleExport() {
    setExporting(true);
    try {
      const start = `${month}-01`;
      const endDate = new Date(`${month}-01T00:00:00Z`);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      const end = endDate.toISOString().slice(0, 10);

      const res = await apiFetch(`/api/leads/export?from=${start}&to=${end}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-report-${month}.csv`;
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
      <h1 className="page-title">Monthly Reports</h1>

      <div className="table-toolbar rounded-xl border border-border mb-5">
        <div className="toolbar-group">
          <label className="toolbar-label">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={currentMonth()} />
        </div>
        <button className="btn-sm btn-export" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting..." : "Download CSV"}
        </button>
      </div>

      {report && (
        <>
          <h2 className="section-title">{monthLabel(month)}</h2>
          <div className="status-grid">
            <div className="card">
              <div className="label">Total Leads</div>
              <div className="value">{report.total}</div>
            </div>
            <div className="card">
              <div className="label">Calls Made</div>
              <div className="value">{report.totalCalls}</div>
            </div>
          </div>

          <div className="chart-row">
            <div className="chart-section">
              <h3>By Model</h3>
              <ModelBarChart models={report.byModel} />
            </div>
            <div className="chart-section">
              <h3>By Status</h3>
              <BarList rows={report.byStatus} emptyText="No data" />
            </div>
          </div>

          <div className="stats-panel">
            <div className="stats-card">
              <h3>Showroom</h3>
              <BarList rows={report.byShowroom} emptyText="No showroom data" />
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
