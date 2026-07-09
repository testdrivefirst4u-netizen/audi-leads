const TOP_N = 8;

// 21+ raw tab names don't fit a legible chart — fold everything past the top
// N into a single "Other" bucket rather than drawing two dozen slivers.
function consolidate(models) {
  if (!models || models.length <= TOP_N) return models || [];
  const top = models.slice(0, TOP_N);
  const rest = models.slice(TOP_N).reduce((sum, m) => sum + m.count, 0);
  return [...top, { label: "Other", count: rest }];
}

export default function ModelBarChart({ models }) {
  const rows = consolidate(models);
  if (rows.length === 0) return <div className="empty-state">No data yet</div>;

  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="model-bar-chart">
      {rows.map((row) => (
        <div className="model-bar-row" key={row.label}>
          <span className="model-bar-label" title={row.label}>
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
