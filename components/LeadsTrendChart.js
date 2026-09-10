import { useState } from "react";

const WIDTH = 760;
const HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
// Taller than the plot strictly needs, so the peak/latest direct labels
// (~28px of text above their point) never clip the top of the viewBox even
// when that point sits at the very top of the plot area.
const PAD_TOP = 40;
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
  // Fewer, hairline gridlines read as calmer/more premium than a dense grid —
  // the anti-pattern is "heavy gridlines, no breathing room," not "too few."
  const gridLines = [0, 0.5, 1];

  // Direct-label the two points that actually matter — the anti-pattern is a
  // tooltip being the *only* way to read a value; today's/period-end count
  // and the peak are worth showing without requiring a hover at all.
  const peakIndex = points.reduce((best, p, i) => (p.count > points[best].count ? i : best), 0);
  const latestIndex = points.length - 1;

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
          {/* Themed to the current company's brand accent, same as
              VerticalBarChart's default single-series bars — this used to
              be a hardcoded blue regardless of company. */}
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#trendFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text key={p.date} x={p.x} y={HEIGHT - 8} fontSize="10" textAnchor="middle" fill="#6b7280">
                {formatShortDate(p.date)}
              </text>
            )
        )}

        {/* Static markers for peak + latest — suppressed at whichever one is
            currently hovered, so the hover tooltip doesn't double up with a
            static label sitting in the same spot. */}
        {[
          { i: peakIndex, isPeak: true },
          ...(latestIndex !== peakIndex ? [{ i: latestIndex, isPeak: false }] : []),
        ].map(({ i, isPeak }) => {
          if (hoverIndex === i) return null;
          const p = points[i];
          return (
            <g key={isPeak ? "peak" : "latest"}>
              <circle cx={p.x} cy={p.y} r="3.5" fill="rgb(var(--accent-rgb))" stroke="#fff" strokeWidth="1.5" />
              <text x={p.x} y={p.y - 22} textAnchor="middle" fontSize="9" fill="#6b7280">
                {isPeak ? "Peak" : "Latest"}
              </text>
              <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1d29">
                {p.count}
              </text>
            </g>
          );
        })}

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
            <circle cx={hovered.x} cy={hovered.y} r="4" fill="rgb(var(--accent-rgb))" stroke="#fff" strokeWidth="2" />
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
