import { useState } from "react";

const WIDTH = 760;
const HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function formatShortDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function LeadsTrendChart({ trend }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!trend || trend.length === 0) {
    return <div className="empty-state">No data yet</div>;
  }

  const max = Math.max(...trend.map((t) => t.count), 1);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stepX = plotWidth / Math.max(trend.length - 1, 1);

  const points = trend.map((t, i) => {
    const x = PAD_LEFT + i * stepX;
    const y = PAD_TOP + plotHeight - (t.count / max) * plotHeight;
    return { x, y, ...t };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${PAD_TOP + plotHeight} L ${points[0].x.toFixed(1)} ${PAD_TOP + plotHeight} Z`;

  // Show ~6 evenly-spaced x-axis labels so they don't overlap.
  const labelEvery = Math.max(1, Math.round(trend.length / 6));
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="trend-chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="trend-chart"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {gridLines.map((g) => {
          const y = PAD_TOP + plotHeight - g * plotHeight;
          return (
            <line
              key={g}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={y}
              y2={y}
              stroke="#e5e8f0"
              strokeWidth="1"
            />
          );
        })}

        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d5afe" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3d5afe" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#trendFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="#3d5afe" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text key={p.date} x={p.x} y={HEIGHT - 8} fontSize="10" textAnchor="middle" fill="#6b7280">
                {formatShortDate(p.date)}
              </text>
            )
        )}

        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PAD_TOP}
              y2={PAD_TOP + plotHeight}
              stroke="#6b7280"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill="#3d5afe" stroke="#fff" strokeWidth="2" />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="trend-tooltip"
          style={{ left: `${(hovered.x / WIDTH) * 100}%`, top: `${(hovered.y / HEIGHT) * 100}%` }}
        >
          <strong>{hovered.count}</strong> lead{hovered.count === 1 ? "" : "s"}
          <div className="hint">{formatShortDate(hovered.date)}</div>
        </div>
      )}
    </div>
  );
}
