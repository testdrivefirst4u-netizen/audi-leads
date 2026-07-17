import { forwardRef, useState } from "react";
import { categoricalColor, OTHER_COLOR } from "../lib/chartPalette";

const SIZE = 200;
const CENTER = 100;
const RADIUS = 80;
const TOP_N = 7; // token ceiling for a categorical pie (see dataviz skill) — rest folds into "Other"
const DIRECT_LABEL_MIN_SHARE = 0.06; // only label slices big enough to read

function consolidate(data) {
  if (!data || data.length <= TOP_N) return data || [];
  const top = data.slice(0, TOP_N);
  const rest = data.slice(TOP_N).reduce((sum, s) => sum + s.count, 0);
  return [...top, { label: "Other", count: rest }];
}

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

// Generic categorical pie for data-driven label sets (model/showroom/source/
// status breakdowns on the Reports page) — colors assigned in the palette's
// fixed slot order by rank, "Other" always neutral gray. Distinct from
// StatusPieChart (dashboard), which has its own fixed status->hue mapping.
const CategoryPieChart = forwardRef(function CategoryPieChart({ data, colorFor }, ref) {
  const [hoverLabel, setHoverLabel] = useState(null);

  const rows = consolidate(data);
  if (rows.length === 0) return <div className="empty-state">No data yet</div>;

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const getColor = colorFor || ((label, i) => categoricalColor(i, label));

  let cursor = 0;
  const slices = rows.map((row, i) => {
    const startAngle = cursor;
    const sweep = total > 0 ? (row.count / total) * 360 : 0;
    cursor += sweep;
    const mid = startAngle + sweep / 2;
    const labelPoint = polarToCartesian(CENTER, CENTER, RADIUS * 0.65, mid);
    const share = total > 0 ? row.count / total : 0;
    return { ...row, startAngle, endAngle: cursor, labelPoint, share, color: getColor(row.label, i) };
  });

  const hovered = slices.find((s) => s.label === hoverLabel && s.count > 0);

  return (
    <div className="pie-chart-layout">
      <div className="trend-chart-wrap" style={{ width: SIZE, flexShrink: 0 }}>
        <svg ref={ref} viewBox={`0 0 ${SIZE} ${SIZE}`} className="trend-chart">
          {total === 0 ? (
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={OTHER_COLOR} />
          ) : (
            slices
              .filter((s) => s.count > 0)
              .map((s) => (
                <g key={s.label}>
                  <path
                    d={slicePath(s.startAngle, s.endAngle)}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth="2"
                    opacity={hoverLabel && hoverLabel !== s.label ? 0.55 : 1}
                    onMouseEnter={() => setHoverLabel(s.label)}
                    onMouseLeave={() => setHoverLabel(null)}
                  />
                  {s.share >= DIRECT_LABEL_MIN_SHARE && (
                    <text
                      x={s.labelPoint.x}
                      y={s.labelPoint.y}
                      fontSize="11"
                      fontWeight="700"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff"
                      pointerEvents="none"
                    >
                      {Math.round(s.share * 100)}%
                    </text>
                  )}
                </g>
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
            <div className="hint">{Math.round(hovered.share * 100)}% of leads</div>
          </div>
        )}
      </div>

      <div className="chart-legend">
        {slices.map((row) => (
          <div
            key={row.label}
            className="chart-legend-item"
            onMouseEnter={() => row.count > 0 && setHoverLabel(row.label)}
            onMouseLeave={() => setHoverLabel(null)}
          >
            <span className="chart-legend-swatch" style={{ background: row.color }} />
            <span className="chart-legend-label">{row.label}</span>
            <span className="chart-legend-count">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default CategoryPieChart;
