import { useState } from "react";
import { BUCKETS, prettyBucket, bucketChartColor } from "../lib/leadFields";

const SIZE = 200;
const CENTER = 100;
const RADIUS = 80;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function slicePath(startAngle, endAngle) {
  const p1 = polarToCartesian(CENTER, CENTER, RADIUS, startAngle);
  const p2 = polarToCartesian(CENTER, CENTER, RADIUS, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
}

// Same shape/anatomy as StatusPieChart (mark specs, hover tooltip, legend) —
// deliberately kept visually consistent since this sits right next to it on
// the dashboard as the equivalent breakdown for buckets instead of status.
export default function BucketPieChart({ buckets }) {
  const [hoverKey, setHoverKey] = useState(null);

  if (!buckets || buckets.length === 0) {
    return <div className="empty-state">No data yet</div>;
  }

  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.count]));
  const rows = BUCKETS.map((key) => ({ key, label: prettyBucket(key), count: byKey[key] || 0 }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  let cursor = 0;
  const slices = rows.map((row) => {
    const startAngle = cursor;
    const sweep = total > 0 ? (row.count / total) * 360 : 0;
    cursor += sweep;
    const mid = startAngle + sweep / 2;
    const labelPoint = polarToCartesian(CENTER, CENTER, RADIUS * 0.65, mid);
    return { ...row, startAngle, endAngle: cursor, labelPoint };
  });

  const hovered = slices.find((s) => s.key === hoverKey && s.count > 0);

  return (
    <div className="pie-chart-layout">
      <div className="trend-chart-wrap" style={{ width: SIZE, flexShrink: 0 }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="trend-chart">
          {total === 0 ? (
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="#e5e8f0" />
          ) : (
            slices
              .filter((s) => s.count > 0)
              .map((s) => (
                <path
                  key={s.key}
                  d={slicePath(s.startAngle, s.endAngle)}
                  fill={bucketChartColor(s.key)}
                  stroke="#fff"
                  strokeWidth="2"
                  opacity={hoverKey && hoverKey !== s.key ? 0.55 : 1}
                  onMouseEnter={() => setHoverKey(s.key)}
                  onMouseLeave={() => setHoverKey(null)}
                />
              ))
          )}
        </svg>

        {hovered && (
          <div
            className="trend-tooltip"
            style={{
              left: `${(hovered.labelPoint.x / SIZE) * 100}%`,
              top: `${(hovered.labelPoint.y / SIZE) * 100}%`,
            }}
          >
            <strong>{hovered.count}</strong> {hovered.label}
            <div className="hint">{total > 0 ? Math.round((hovered.count / total) * 100) : 0}% of leads</div>
          </div>
        )}
      </div>

      <div className="chart-legend">
        {rows.map((row) => (
          <div
            key={row.key}
            className="chart-legend-item"
            onMouseEnter={() => row.count > 0 && setHoverKey(row.key)}
            onMouseLeave={() => setHoverKey(null)}
          >
            <span className="chart-legend-swatch" style={{ background: bucketChartColor(row.key) }} />
            <span className="chart-legend-label">{row.label}</span>
            <span className="chart-legend-count">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
