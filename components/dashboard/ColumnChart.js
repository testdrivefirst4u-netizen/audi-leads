// Upright bars with the count printed on each one and dashed gridlines, as in
// Zoho's report charts ("Monthly lead creation", "Booking source"). Scrolls
// sideways when there are more bars than fit, so labels never squash.
// data: [{ label, count, title? }]
function niceMax(n) {
  if (n <= 5) return 5;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}

const short = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

export default function ColumnChart({ data, color = "#7ad48a", height = 170, minBarWidth = 30, slantLabels = false, yLabel = "", emptyText = "Nothing to show yet." }) {
  const rows = data || [];
  if (!rows.some((r) => r.count > 0)) return <p className="m-0 py-6 text-center text-[13px] text-muted">{emptyText}</p>;
  const top = niceMax(Math.max(...rows.map((r) => r.count)));
  const ticks = [top, top / 2, 0];

  return (
    <div className="flex gap-2">
      {yLabel && (
        <div className="shrink-0 flex items-center">
          <span className="text-[10.5px] text-muted [writing-mode:vertical-rl] rotate-180">{yLabel}</span>
        </div>
      )}
      <div className="shrink-0 relative text-right text-[10px] text-muted" style={{ height, marginTop: 16, width: 34 }}>
        {ticks.map((t, i) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
            {short(t)}
          </span>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="relative" style={{ minWidth: rows.length * minBarWidth }}>
          <div className="relative flex items-end gap-[6px] border-b border-border" style={{ height: height + 16, paddingTop: 16 }}>
            {ticks.slice(0, -1).map((t, i) => (
              <div key={t} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: 16 + (i / (ticks.length - 1)) * height }} aria-hidden />
            ))}
            {rows.map((r) => (
              <div key={r.label} className="relative flex-1 flex flex-col items-center justify-end h-full min-w-0" title={r.title || `${r.label}: ${r.count}`}>
                {r.count > 0 && <span className="text-[10px] font-semibold text-ink leading-none mb-1">{r.count}</span>}
                <div className="w-full max-w-[44px] rounded-t-[3px]" style={{ height: (r.count / top) * height, background: color, minHeight: r.count ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-[6px]" style={{ height: slantLabels ? 58 : 30 }}>
            {rows.map((r) => (
              <div key={r.label} className="relative flex-1 min-w-0">
                {slantLabels ? (
                  <span className="absolute right-1/2 top-1 whitespace-nowrap text-[10px] text-muted origin-top-right -rotate-45">{r.label}</span>
                ) : (
                  <span className="block pt-1.5 text-center text-[10.5px] text-muted truncate">{r.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
