import DonutChart from "./DonutChart";
import { BUCKETS, prettyBucket, bucketChartColor } from "../lib/leadFields";

// Same shape/anatomy as StatusPieChart (both are thin DonutChart wrappers) —
// deliberately kept visually consistent since this sits right next to it on
// the dashboard as the equivalent breakdown for buckets instead of status.
export default function BucketPieChart({ buckets }) {
  if (!buckets || buckets.length === 0) {
    return <div className="empty-state">No data yet</div>;
  }

  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.count]));
  const rows = BUCKETS.map((key) => ({ key, label: prettyBucket(key), count: byKey[key] || 0 }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const data = rows.filter((row) => row.count > 0).map((row) => ({ ...row, color: bucketChartColor(row.key) }));

  return <DonutChart data={data} keyField="key" centerLabel={total} centerSubLabel="Total Leads" />;
}
