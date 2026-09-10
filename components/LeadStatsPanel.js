import BarListChart from "./BarListChart";
import { PhoneIcon } from "./icons";

export default function LeadStatsPanel({ stats }) {
  if (!stats) return null;

  // "Not Filled" is a non-answer, not a third option alongside Yes/No — it
  // shouldn't compete visually with the real signal (BarListChart renders a
  // muted row for it via the `muted` flag).
  const exchangeRows = (stats.exchange || []).map((row) => (row.label === "Not Filled" ? { ...row, muted: true } : row));

  return (
    <div className="dash-panel-grid">
      <div className="dash-panel mb-0">
        <h3>Exchange Plan</h3>
        <BarListChart data={exchangeRows} emptyText="No data" />
      </div>
      <div className="dash-panel mb-0">
        <h3>Showroom</h3>
        <BarListChart data={stats.showroom} emptyText="No showroom data in this sheet" />
      </div>
      <div className="dash-panel mb-0">
        <h3 className="flex items-center gap-1.5">
          <PhoneIcon className="text-muted" />
          Calls Made
        </h3>
        <div className="hero-number">{stats.totalCalls ?? 0}</div>
        <div className="hint">Total call attempts logged across every lead</div>
      </div>
    </div>
  );
}
