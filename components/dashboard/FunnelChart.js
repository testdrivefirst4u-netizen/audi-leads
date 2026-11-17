// Zoho-style funnel ("Lead stage", "Deals by stages"): one band per stage,
// as wide as how many leads stand at that stage now, each tapering into the
// next, with "Stage : count" labels on leader lines to the right. Widths are
// softened (square root) so small stages stay visible.
// stages: [{ label, count, color }]
const W = 400;
const BAND = 28;
const FUNNEL_W = 170;
const MIN_W = 10;

export default function FunnelChart({ stages, emptyText = "No leads in this period yet." }) {
  const rows = stages || [];
  const max = Math.max(0, ...rows.map((s) => s.count));
  if (!max) return <p className="m-0 py-6 text-center text-[13px] text-muted">{emptyText}</p>;

  const width = (n) => Math.max(MIN_W, Math.sqrt(n / max) * FUNNEL_W);
  const cx = 14 + FUNNEL_W / 2;
  const labelX = 14 + FUNNEL_W + 28;
  const H = rows.length * BAND + 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label={rows.map((s) => `${s.label} ${s.count}`).join(", ")}>
      {rows.map((s, i) => {
        const top = width(s.count);
        const bottom = i < rows.length - 1 ? width(rows[i + 1].count) : top * 0.7;
        const y = 4 + i * BAND;
        const midY = y + BAND / 2;
        const edge = cx + (top + bottom) / 4;
        return (
          <g key={s.label}>
            <polygon
              points={`${cx - top / 2},${y} ${cx + top / 2},${y} ${cx + bottom / 2},${y + BAND - 1} ${cx - bottom / 2},${y + BAND - 1}`}
              fill={s.color}
            >
              <title>{`${s.label}: ${s.count}`}</title>
            </polygon>
            <polyline points={`${edge},${midY} ${labelX - 6},${midY}`} fill="none" stroke={s.color} strokeWidth="1" />
            <text x={labelX} y={midY + 4} className="fill-current text-ink" fontSize="12.5">
              {s.label} : <tspan fontWeight="700">{s.count}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
