import { useState } from "react";
import ChartViewToggle from "./ChartViewToggle";

const TOP_N = 8;

// Folds everything past the top N into "Other" — but if the data already has
// its own genuine "Other" bucket within the top N (e.g. canonicalModelFor()
// already classifies unmatched models as "Other"), the fold merges into that
// SAME row instead of appending a second one. Two rows both labeled "Other"
// with different counts is confusing, not just untidy — this was a real bug
// in the old ModelBarChart.js's consolidate(), reproduced here fixed.
function consolidate(rows) {
  if (!rows || rows.length <= TOP_N) return rows || [];
  const top = rows.slice(0, TOP_N);
  const restTotal = rows.slice(TOP_N).reduce((sum, r) => sum + r.count, 0);
  const existingOther = top.find((r) => r.label === "Other");
  if (existingOther) {
    return top.map((r) => (r.label === "Other" ? { ...r, count: r.count + restTotal } : r));
  }
  return [...top, { label: "Other", count: restTotal }];
}

// Generic ranked label+count list — Lead Source, Leads by Campaign, Leads by
// Model, Exchange Plan, and Showroom are all this exact same data shape.
// Renders a stat tile instead of a bar when there's only one row: a single
// full-width bar is never informative (it's always 100% of itself), which is
// exactly the "one-bar bar chart" the dataviz method flags — most companies
// have exactly one lead source today, so this matters in practice, not just
// in theory.
export default function BarListChart({ data, emptyText = "No data yet" }) {
  const [hoverLabel, setHoverLabel] = useState(null);
  const [view, setView] = useState("chart");

  if (!data || data.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }

  if (data.length === 1) {
    const [only] = data;
    return (
      <div className="bar-list-single">
        <div className="hero-number">{only.count}</div>
        <div className="hint">{only.label} — 100% of leads</div>
      </div>
    );
  }

  const rows = consolidate(data);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div>
      <div className="chart-view-toggle-row">
        <ChartViewToggle view={view} onChange={setView} />
      </div>
      {view === "table" ? (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Count</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.count}</td>
                <td>{total > 0 ? Math.round((row.count / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="model-bar-chart">
          {rows.map((row) => (
            <div
              className={`model-bar-row ${hoverLabel === row.label ? "is-hovered" : ""} ${row.muted ? "is-muted" : ""}`}
              key={row.label}
              onMouseEnter={() => setHoverLabel(row.label)}
              onMouseLeave={() => setHoverLabel(null)}
            >
              <span className="model-bar-label" title={row.label}>
                {row.label}
              </span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
              <span className="bar-count">
                {row.count}
                <span className="chart-legend-pct">{total > 0 ? Math.round((row.count / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
