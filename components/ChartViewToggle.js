// Tiny shared control for DonutChart.js/BarListChart.js's chart<->table
// toggle — a table twin for every chart is the dataviz method's own
// accessibility rule (every value also reachable without parsing an SVG).
export default function ChartViewToggle({ view, onChange }) {
  return (
    <div className="chart-view-toggle" role="tablist" aria-label="Chart or table view">
      <button type="button" role="tab" aria-selected={view === "chart"} className={view === "chart" ? "is-active" : ""} onClick={() => onChange("chart")}>
        Chart
      </button>
      <button type="button" role="tab" aria-selected={view === "table"} className={view === "table" ? "is-active" : ""} onClick={() => onChange("table")}>
        Table
      </button>
    </div>
  );
}
