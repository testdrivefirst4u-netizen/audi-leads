import Link from "next/link";
import Skeleton from "react-loading-skeleton";

// A tiny trend line under the number (no axes) — the shape matters, not the values.
function Sparkline({ values }) {
  if (!values || values.length < 2) return null;
  const W = 120;
  const H = 30;
  const max = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [i * step, H - 2 - (v / max) * (H - 4)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash2-spark" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="rgb(var(--accent-rgb) / 0.10)" />
      <path d={line} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * A KPI component: label, big number, and either a change vs a previous
 * value ("▲ 3 vs yesterday") or a caption — plus an optional sparkline.
 * `tone="alert"` colours the number when it needs attention (e.g. overdue).
 */
export default function KpiCard({ label, value, icon: Icon, delta, deltaLabel, caption, spark, href, tone, loading }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="dash2-kpi-label">{label}</span>
        {Icon && (
          <span className={`dash2-kpi-icon ${tone === "alert" ? "is-alert" : ""}`}>
            <Icon width={15} height={15} />
          </span>
        )}
      </div>
      <div className={`dash2-kpi-value ${tone === "alert" && value > 0 ? "text-danger" : ""}`}>{loading ? <Skeleton width={56} /> : value ?? 0}</div>
      <div className="dash2-kpi-foot">
        {loading ? (
          <Skeleton width={90} height={10} />
        ) : delta != null ? (
          <span className={delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted"}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta)} {deltaLabel}
          </span>
        ) : (
          <span className="text-muted">{caption}</span>
        )}
      </div>
      {!loading && <Sparkline values={spark} />}
    </>
  );
  return href ? (
    <Link href={href} className="dash2-kpi is-link">
      {body}
    </Link>
  ) : (
    <div className="dash2-kpi">{body}</div>
  );
}
