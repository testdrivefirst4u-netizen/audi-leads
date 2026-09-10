import { useState } from "react";
import ChartViewToggle from "./ChartViewToggle";

// Shared by StatusPieChart.js and BucketPieChart.js — same anatomy (donut
// ring, hover-dim + tooltip, legend), just fed different data/colors. A
// donut instead of a full pie makes room for a center total, which a plain
// pie can't show without covering a slice.
const SIZE = 200;
const CENTER = 100;
const OUTER_RADIUS = 80;
const INNER_RADIUS = 52;
const LABEL_RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function donutSlicePath(startAngle, endAngle) {
  const outerStart = polarToCartesian(CENTER, CENTER, OUTER_RADIUS, startAngle);
  const outerEnd = polarToCartesian(CENTER, CENTER, OUTER_RADIUS, endAngle);
  const innerStart = polarToCartesian(CENTER, CENTER, INNER_RADIUS, startAngle);
  const innerEnd = polarToCartesian(CENTER, CENTER, INNER_RADIUS, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

// `data` is expected pre-filtered to count > 0 and pre-colored by the
// caller — this component only draws, it doesn't decide what belongs in
// the chart (StatusPieChart/BucketPieChart own that decision, since only
// they know which zero-count categories are meaningless to show).
export default function DonutChart({ data, keyField = "label", centerLabel, centerSubLabel, emptyText = "No data yet" }) {
  const [hoverKey, setHoverKey] = useState(null);
  const [view, setView] = useState("chart");

  if (!data || data.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }

  const total = data.reduce((sum, r) => sum + r.count, 0);

  if (view === "table") {
    return (
      <div>
        <div className="chart-view-toggle-row">
          <ChartViewToggle view={view} onChange={setView} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Count</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row[keyField]}>
                <td>
                  <span className="chart-legend-swatch" style={{ background: row.color, marginRight: 8 }} />
                  {row.label}
                </td>
                <td>{row.count}</td>
                <td>{total > 0 ? Math.round((row.count / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  let cursor = 0;
  const slices = data.map((row) => {
    const startAngle = cursor;
    const sweep = total > 0 ? (row.count / total) * 360 : 0;
    cursor += sweep;
    const mid = startAngle + sweep / 2;
    const labelPoint = polarToCartesian(CENTER, CENTER, LABEL_RADIUS, mid);
    return { ...row, startAngle, endAngle: cursor, labelPoint };
  });

  const hovered = slices.find((s) => s[keyField] === hoverKey);

  return (
    <div>
      <div className="chart-view-toggle-row">
        <ChartViewToggle view={view} onChange={setView} />
      </div>
      <div className="pie-chart-layout">
      <div className="trend-chart-wrap" style={{ width: SIZE, flexShrink: 0 }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="trend-chart">
          {total === 0 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={LABEL_RADIUS}
              fill="none"
              stroke="#e5e8f0"
              strokeWidth={OUTER_RADIUS - INNER_RADIUS}
            />
          ) : (
            slices.map((s) => (
              <path
                key={s[keyField]}
                d={donutSlicePath(s.startAngle, s.endAngle)}
                fill={s.color}
                stroke="#fff"
                strokeWidth="2"
                opacity={hoverKey && hoverKey !== s[keyField] ? 0.55 : 1}
                onMouseEnter={() => setHoverKey(s[keyField])}
                onMouseLeave={() => setHoverKey(null)}
              />
            ))
          )}

          {/* Center total — the reason this is a donut and not a pie. */}
          {centerLabel !== undefined && (
            <>
              <text x={CENTER} y={centerSubLabel ? CENTER - 4 : CENTER + 6} textAnchor="middle" fontSize="24" fontWeight="800" fill="#1a1d29">
                {centerLabel}
              </text>
              {centerSubLabel && (
                <text x={CENTER} y={CENTER + 16} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#6b7280">
                  {centerSubLabel}
                </text>
              )}
            </>
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
        {data.map((row) => (
          <div
            key={row[keyField]}
            className="chart-legend-item"
            onMouseEnter={() => setHoverKey(row[keyField])}
            onMouseLeave={() => setHoverKey(null)}
          >
            <span className="chart-legend-swatch" style={{ background: row.color }} />
            <span className="chart-legend-label">{row.label}</span>
            <span className="chart-legend-count">
              {row.count}
              <span className="chart-legend-pct">{total > 0 ? Math.round((row.count / total) * 100) : 0}%</span>
            </span>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
