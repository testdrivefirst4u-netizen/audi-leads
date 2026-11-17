// Donut with every slice labelled outside it ("Google Calls / 31928 (9.78 %)")
// on a leader line, as in Zoho's "Leads by source" / "Leads by status".
// Labels sit on the left or right of the ring by which half their slice is
// in, and are pushed apart vertically so none overlap.
// data: [{ label, count, color? }]
export const DONUT_COLORS = ["#4a6bd6", "#c45fb3", "#14c3c3", "#f2853f", "#2fcf6f", "#ffa600", "#7fc8f8", "#7d8592", "#f5c542", "#e84a5f", "#5ab4ac", "#a17fe0"];

const MAX_SLICES = 11; // the rest are grouped as "Others"
const GAP = 30; // px between label rows
const W = 440;

function arc(cx, cy, r, r0, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
  return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

// Spread label y positions at least GAP apart, inside [lo, hi].
function spread(items, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 0; i < items.length; i++) items[i].y = Math.max(items[i].y, i ? items[i - 1].y + GAP : lo);
  for (let i = items.length - 1; i >= 0; i--) items[i].y = Math.min(items[i].y, i < items.length - 1 ? items[i + 1].y - GAP : hi);
}

const pct = (n, total) => `${((n / total) * 100).toFixed(2)} %`;
const clip = (s, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function DonutChart({ data, emptyText = "Nothing to show yet." }) {
  const sorted = (data || []).filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
  const total = sorted.reduce((sum, d) => sum + d.count, 0);
  if (!total) return <p className="m-0 py-6 text-center text-[13px] text-muted">{emptyText}</p>;

  const rest = sorted.slice(MAX_SLICES);
  const slices = sorted.slice(0, MAX_SLICES).map((d, i) => ({ ...d, color: d.color || DONUT_COLORS[i % DONUT_COLORS.length] }));
  if (rest.length) slices.push({ label: "Others", count: rest.reduce((sum, d) => sum + d.count, 0), color: "#c4c9d2" });

  const perSide = Math.ceil(slices.length / 2) + 1;
  const H = Math.max(270, perSide * GAP + 30);
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(78, H / 2 - 30);
  const r0 = r * 0.62;

  let angle = -Math.PI / 2;
  const left = [];
  const right = [];
  const paths = slices.map((s) => {
    const a0 = angle;
    const a1 = angle + (s.count / total) * Math.PI * 2;
    angle = a1;
    const mid = (a0 + a1) / 2;
    const item = { ...s, mid, y: cy + (r + 16) * Math.sin(mid) };
    (Math.cos(mid) >= 0 ? right : left).push(item);
    // a single slice is a full ring: two half arcs
    const d = slices.length === 1 ? `${arc(cx, cy, r, r0, -Math.PI / 2, Math.PI / 2)} ${arc(cx, cy, r, r0, Math.PI / 2, (3 * Math.PI) / 2)}` : arc(cx, cy, r, r0, a0, a1);
    return { d, color: s.color, label: s.label, count: s.count };
  });
  spread(left, 14, H - 22);
  spread(right, 14, H - 22);

  const label = (it, side) => {
    const ex = cx + (r + 4) * Math.cos(it.mid);
    const ey = cy + (r + 4) * Math.sin(it.mid);
    const kx = cx + (r + 18) * Math.cos(it.mid);
    const tx = side === "right" ? cx + r + 34 : cx - r - 34;
    const anchor = side === "right" ? "start" : "end";
    const textX = side === "right" ? tx + 4 : tx - 4;
    return (
      <g key={`${it.label}-${side}`}>
        <polyline points={`${ex},${ey} ${kx},${it.y} ${tx},${it.y}`} fill="none" stroke={it.color} strokeWidth="1" />
        <text x={textX} y={it.y - 2} textAnchor={anchor} className="fill-current text-ink" fontSize="12.5">
          {clip(it.label)}
        </text>
        <text x={textX} y={it.y + 12} textAnchor={anchor} className="fill-current text-muted" fontSize="11.5">
          {it.count} ({pct(it.count, total)})
        </text>
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label={slices.map((s) => `${s.label} ${s.count}`).join(", ")}>
      {paths.map((p) => (
        <path key={p.label} d={p.d} fill={p.color} stroke="rgb(var(--card-rgb, 255 255 255))" strokeWidth="1">
          <title>{`${p.label}: ${p.count} (${pct(p.count, total)})`}</title>
        </path>
      ))}
      {left.map((it) => label(it, "left"))}
      {right.map((it) => label(it, "right"))}
    </svg>
  );
}
