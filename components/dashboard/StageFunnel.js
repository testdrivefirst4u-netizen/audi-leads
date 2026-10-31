import { statusChartColor } from "../../lib/leadFields";

// The statuses the funnel is built from. A company that has renamed or
// replaced them (Settings.statusOptions) doesn't have these stages, so the
// Dashboard falls back to the plain pipeline chart for it (see canDrawFunnel).
const PATH = ["New", "Contacted", "Qualified", "Test Drive", "Booking", "Retail (Converted)"];

export function canDrawFunnel(pipeline) {
  const labels = new Set((pipeline || []).map((p) => p.label));
  return PATH.every((s) => labels.has(s)) && labels.has("Call Back") && labels.has("Lost");
}

const fmt = (p) => (p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)) + "%";

/**
 * Tapered funnel for the Pipeline panel: how many leads reached each stage,
 * and what share of the previous stage moved on — so the biggest drop-off is
 * visible at a glance. "Reached" is worked out from where each lead stands
 * now (a lead at Booking has also been contacted, qualified and
 * test-driven), the same rule as the Conversion panel. Call Back and Lost
 * aren't steps on the way to a sale, so they sit beside the funnel.
 *
 * Band widths are softened (square root) so the small late stages stay
 * readable; the exact count is printed on every band.
 */
export default function StageFunnel({ pipeline }) {
  const n = Object.fromEntries((pipeline || []).map((p) => [p.label, p.count || 0]));
  const total = (pipeline || []).reduce((sum, p) => sum + (p.count || 0), 0);
  const won = n["Booking"] + n["Retail (Converted)"];
  const stages = [
    { label: "Enquiries", count: total, color: statusChartColor("New") },
    { label: "Contacted", count: total - n["New"], color: statusChartColor("Contacted") },
    { label: "Qualified", count: n["Qualified"] + n["Test Drive"] + won, color: statusChartColor("Qualified") },
    { label: "Test drive", count: n["Test Drive"] + won, color: statusChartColor("Test Drive") },
    { label: "Booked", count: won, color: statusChartColor("Booking") },
    { label: "Retail", count: n["Retail (Converted)"], color: statusChartColor("Retail (Converted)") },
  ];

  if (!total) return <p className="m-0 py-6 text-center text-[13px] text-muted">No leads in this period yet.</p>;

  // the stage that loses the biggest share of the one before it
  let worst = -1;
  let worstRate = 101;
  stages.forEach((s, i) => {
    if (i === 0 || !stages[i - 1].count) return;
    const r = (s.count / stages[i - 1].count) * 100;
    if (r < worstRate) {
      worstRate = r;
      worst = i;
    }
  });

  // Band widths as % of the band column, softened (square root) so late stages stay readable.
  const MIN_PCT = 24;
  const widthPct = (c) => MIN_PCT + (100 - MIN_PCT) * Math.sqrt(c / total);

  // One row per stage — name | band | figures — so the text keeps its size on
  // any screen; only the band itself is drawn (an SVG stretched to its cell).
  return (
    <div>
      <ol className="list-none m-0 p-0 grid gap-x-2.5 gap-y-1.5 items-center grid-cols-[66px_minmax(0,1fr)_104px] sm:grid-cols-[84px_minmax(0,1fr)_132px]" aria-label="Lead funnel: how many leads reached each stage">
        {stages.map((s, i) => {
          const w1 = widthPct(s.count);
          const w2 = i < stages.length - 1 ? widthPct(stages[i + 1].count) : w1 * 0.86;
          const pts = `${50 - w1 / 2},0 ${50 + w1 / 2},0 ${50 + w2 / 2},34 ${50 - w2 / 2},34`;
          const step = i > 0 && stages[i - 1].count ? (s.count / stages[i - 1].count) * 100 : null;
          return (
            <li key={s.label} className="contents" title={`${s.label}: ${s.count} leads${step != null ? ` · ${fmt(step)} of ${stages[i - 1].label.toLowerCase()}` : ""}`}>
              <span className="text-right text-[12px] font-semibold text-ink truncate">{s.label}</span>
              <span className="relative block h-[34px]">
                <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
                  <polygon points={pts} fill={s.color} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-white text-[13px] font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {s.count.toLocaleString()}
                </span>
              </span>
              {step == null ? (
                <span className="text-[11.5px] text-muted">all leads</span>
              ) : (
                <span className="leading-tight min-w-0">
                  <span className={`block text-[12px] font-semibold ${i === worst ? "text-danger" : "text-ink"}`}>{fmt(step)} moved on</span>
                  <span className={`block text-[11px] ${i === worst ? "text-danger font-semibold" : "text-muted"}`}>
                    {i === worst ? "biggest drop" : `${fmt((s.count / total) * 100)} of all`}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* not steps toward a sale, so they sit beside the funnel */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          ["Call Back", "waiting for a call back"],
          ["Lost", "dropped out"],
        ].map(([status, note]) => (
          <div key={status} className="flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-2" style={{ borderColor: statusChartColor(status) }}>
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: statusChartColor(status) }} />
            <span className="min-w-0 text-[12.5px] leading-tight">
              <span className="font-semibold text-ink">
                {status} · {n[status].toLocaleString()}
              </span>
              <span className="block text-[11.5px] text-muted">
                {note} · {fmt((n[status] / total) * 100)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
