import { forwardRef, useState } from "react";

const TOP_N = 8;
const WIDTH = 560;
const HEIGHT = 280;
const PAD_LEFT = 34;
const PAD_RIGHT = 12;
const PAD_TOP = 24;
const PAD_BOTTOM = 56;
const BAR_GAP = 10;
const BAR_RADIUS = 4;

// Magnitude comparison across named categories -> bar chart. Default color
// job is sequential single hue (the bar's height already encodes the count),
// themed via --accent-rgb. When a report pairs this with a pie chart of the
// same categories, pass `colorFor` to match each bar to its pie slice —
// cross-chart identity tracking is a legitimate exception to "one hue".
function consolidate(data) {
  if (!data || data.length <= TOP_N) return data || [];
  const top = data.slice(0, TOP_N);
  const rest = data.slice(TOP_N).reduce((sum, s) => sum + s.count, 0);
  return [...top, { label: "Other", count: rest }];
}

function topRoundedBarPath(x, y, w, h) {
  const r = Math.min(BAR_RADIUS, w / 2, h);
  if (h <= 0) return "";
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

const VerticalBarChart = forwardRef(function VerticalBarChart({ data, colorFor }, ref) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const rows = consolidate(data);
  if (rows.length === 0) return <div className="empty-state">No data yet</div>;

  const max = Math.max(...rows.map((r) => r.count), 1);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;
  const slotWidth = plotWidth / rows.length;
  const barWidth = Math.max(slotWidth - BAR_GAP, 4);

  const bars = rows.map((row, i) => {
    const h = (row.count / max) * plotHeight;
    const x = PAD_LEFT + i * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseline - h;
    return { ...row, x, y, w: barWidth, h, centerX: x + barWidth / 2 };
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const hovered = hoverIndex !== null ? bars[hoverIndex] : null;

  return (
    <div className="trend-chart-wrap">
      <svg ref={ref} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-chart">
        {gridLines.map((g) => {
          const y = PAD_TOP + plotHeight - g * plotHeight;
          return <line key={g} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="#e5e8f0" strokeWidth="1" />;
        })}

        {bars.map((bar, i) => (
          <path
            key={bar.label}
            d={topRoundedBarPath(bar.x, bar.y, bar.w, bar.h)}
            className={colorFor ? undefined : "fill-accent"}
            fill={colorFor ? colorFor(bar.label, i) : undefined}
            opacity={hoverIndex !== null && hoverIndex !== i ? 0.6 : 1}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
          />
        ))}

        {bars.map((bar) => (
          <text key={`value-${bar.label}`} x={bar.centerX} y={bar.y - 6} fontSize="11" fontWeight="700" textAnchor="middle" fill="#374151">
            {bar.count}
          </text>
        ))}

        {bars.map((bar) => (
          <text
            key={`label-${bar.label}`}
            x={bar.centerX}
            y={HEIGHT - PAD_BOTTOM + 16}
            fontSize="11"
            textAnchor="end"
            fill="#6b7280"
            transform={`rotate(-30 ${bar.centerX} ${HEIGHT - PAD_BOTTOM + 16})`}
          >
            {bar.label.length > 14 ? `${bar.label.slice(0, 13)}…` : bar.label}
          </text>
        ))}
      </svg>

      {hovered && (
        <div
          className="trend-tooltip"
          style={{ left: `${(hovered.centerX / WIDTH) * 100}%`, top: `${(hovered.y / HEIGHT) * 100}%` }}
        >
          <strong>{hovered.count}</strong> lead{hovered.count === 1 ? "" : "s"}
          <div className="hint">{hovered.label}</div>
        </div>
      )}
    </div>
  );
});

export default VerticalBarChart;
