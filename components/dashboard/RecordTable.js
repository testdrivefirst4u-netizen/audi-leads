// Two-column ranked table ("1.Google Calls … 3019"), as in Zoho's
// "Top 10 lead sources" and "Junk leads by source".
// rows: [{ label, count }]
export default function RecordTable({ rows, heading = "Lead Source", limit = 10, emptyText = "Nothing to show yet." }) {
  const list = (rows || []).filter((r) => r.count > 0).slice(0, limit);
  if (!list.length) return <p className="m-0 py-6 text-center text-[13px] text-muted">{emptyText}</p>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-2 pr-2 font-semibold text-ink">{heading}</th>
          <th className="py-2 pl-2 text-right font-semibold text-ink">Record Count</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => (
          <tr key={r.label} className="border-b border-border/70 last:border-0">
            <td className="py-2 pr-2 text-ink truncate max-w-0 w-full" title={r.label}>
              {i + 1}.{r.label}
            </td>
            <td className="py-2 pl-2 text-right tabular-nums text-ink">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
