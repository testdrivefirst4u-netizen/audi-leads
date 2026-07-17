import { useState } from "react";
import { statusChartColor } from "../lib/leadFields";

// New -> Contacted -> Qualified -> Test Drive -> Booking -> Retail (Converted)
// reads as a real funnel (each stage a subset of the one before); Lost is an
// exit branch, not a sequential stage, so it's shown separately below rather
// than narrowing the funnel further. Each stage keeps the same hue it uses in
// StatusPieChart (statusChartColor) so a status reads as the same color in
// both charts.
const FUNNEL_ORDER = ["New", "Contacted", "Qualified", "Test Drive", "Booking", "Retail (Converted)"];

const WIDTH = 360;
const HEIGHT = 220;
const PAD_LEFT = 28;
const PAD_RIGHT = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 44;
const BAR_GAP = 8;
const BAR_RADIUS = 4;

function topRoundedBarPath(x, y, w, h) {
  const r = Math.min(BAR_RADIUS, w / 2, h);
  if (h <= 0) return "";
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

export default function PipelineStats({ pipeline }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!pipeline) return null;

  const byLabel = Object.fromEntries(pipeline.map((p) => [p.label, p.count]));
  const lost = byLabel.Lost || 0;
  const stages = FUNNEL_ORDER.map((label) => ({ label, count: byLabel[label] || 0 }));
  const max = Math.max(...stages.map((s) => s.count), 1);

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;
  const slotWidth = plotWidth / stages.length;
  const barWidth = Math.max(slotWidth - BAR_GAP, 4);

  const bars = stages.map((stage, i) => {
    const h = (stage.count / max) * plotHeight;
    const x = PAD_LEFT + i * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseline - h;
    return { ...stage, x, y, w: barWidth, h, centerX: x + barWidth / 2 };
  });

  const gridLines = [0, 0.5, 1];
  const hovered = hoverIndex !== null ? bars[hoverIndex] : null;

  return (
    <div>
      <div className="trend-chart-wrap">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-chart">
          {gridLines.map((g) => {
            const y = PAD_TOP + plotHeight - g * plotHeight;
            return <line key={g} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="#e5e8f0" strokeWidth="1" />;
          })}

          {bars.map((bar, i) => (
            <path
              key={bar.label}
              d={topRoundedBarPath(bar.x, bar.y, bar.w, bar.h)}
              fill={statusChartColor(bar.label)}
              opacity={hoverIndex !== null && hoverIndex !== i ? 0.55 : 1}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          ))}

          {bars.map((bar) => (
            <text
              key={`label-${bar.label}`}
              x={bar.centerX}
              y={HEIGHT - PAD_BOTTOM + 14}
              fontSize="10"
              textAnchor="end"
              fill="#6b7280"
              transform={`rotate(-30 ${bar.centerX} ${HEIGHT - PAD_BOTTOM + 14})`}
            >
              {bar.label}
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

      {lost > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
          <span className="text-muted">Lost (dropped out of pipeline)</span>
          <span className="font-bold" style={{ color: statusChartColor("Lost") }}>
            {lost}
          </span>
        </div>
      )}
    </div>
  );
}
