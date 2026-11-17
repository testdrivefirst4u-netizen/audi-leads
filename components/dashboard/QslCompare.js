// "QSL month-wise comparison": one box per month, filled from the bottom by
// how many qualified-or-further leads that month had against the best month
// shown, with the count in the corner ("1.938 K") as in Zoho.
// months: [{ month: "2026-11", count, qualified }]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthName = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(3)} K` : String(n));

export default function QslCompare({ months }) {
  const rows = months || [];
  const max = Math.max(0, ...rows.map((m) => m.qualified));
  if (!rows.length) return <p className="m-0 py-6 text-center text-[13px] text-muted">Nothing to show yet.</p>;
  return (
    <div className="flex gap-2">
      <div className="hidden sm:flex shrink-0 items-center pt-6 pr-1 text-[11px] font-semibold text-ink">QSL</div>
      <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {rows.map((m) => {
          const share = m.count ? Math.round((m.qualified / m.count) * 100) : 0;
          return (
            <div key={m.month} className="min-w-0">
              <div className="mb-2 text-center text-[12px] font-semibold text-ink">{monthName(m.month)}</div>
              <div className="relative h-[170px] border border-[#f87171]" title={`${m.qualified} qualified of ${m.count} leads`}>
                <div className="absolute inset-x-0 bottom-0 bg-[#ff7676]" style={{ height: max ? `${(m.qualified / max) * 100}%` : 0 }} />
                <span className="absolute right-1.5 top-1 text-[10.5px] text-ink">{kilo(m.qualified)}</span>
              </div>
              <div className="mt-1.5 text-center text-[11px] text-muted">
                {share}% of {m.count} leads
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
