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

export default function LeadStatsPanel({ stats }) {
  if (!stats) return null;

  return (
    <div className="stats-panel">
      <div className="stats-card">
        <h3>Exchange Plan</h3>
        <BarList rows={stats.exchange} emptyText="No data" />
      </div>
      <div className="stats-card">
        <h3>Showroom</h3>
        <BarList rows={stats.showroom} emptyText="No showroom data in this sheet" />
      </div>
      <div className="stats-card">
        <h3>Leads by Model</h3>
        <BarList rows={stats.models} emptyText="No data" />
      </div>
    </div>
  );
}
