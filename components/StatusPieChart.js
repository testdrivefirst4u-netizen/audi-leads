import DonutChart from "./DonutChart";
import { statusChartColor } from "../lib/leadFields";

// pipeline already reflects this company's own status list, in order —
// computed server-side in pages/api/stats.js from Settings.statusOptions (or
// the app-wide default). No re-derivation against a hardcoded global list
// here, or a company's custom statuses would silently vanish from the chart.
// Zero-count statuses are dropped before reaching DonutChart — a company
// that's never used "Test Drive" shouldn't see a dead "0" row in its legend.
export default function StatusPieChart({ pipeline }) {
  if (!pipeline || pipeline.length === 0) {
    return <div className="empty-state">No data yet</div>;
  }

  const data = pipeline
    .filter((row) => row.count > 0)
    .map((row) => ({ ...row, color: statusChartColor(row.label) }));
  const total = pipeline.reduce((sum, r) => sum + r.count, 0);

  return <DonutChart data={data} centerLabel={total} centerSubLabel="Total Leads" />;
}
