import { useState } from "react";
import Link from "next/link";
import { statusChartColor } from "../../lib/leadFields";

// "New this week" table (Zoho's list view): this week's leads, newest first,
// 10 to a page; a row opens the lead on the Leads page.
// week: { total, leads: [{ id, name, phone, owner, date, model, source, status }] }
const PAGE = 10;
const pad = (n) => String(n).padStart(2, "0");
// dd/mm/yyyy without the browser locale (the server renders the same text)
const day = (d) => {
  if (!d) return "";
  const t = new Date(d);
  return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()}`;
};

const COLS = ["Name", "Phone", "Owner", "Enquiry date", "Model", "Status", "Lead source"];

export default function NewThisWeek({ week }) {
  const [page, setPage] = useState(0);
  const leads = week?.leads || [];
  const total = week?.total || 0;
  if (!leads.length) return <p className="m-0 py-6 text-center text-[13px] text-muted">No new leads this week yet.</p>;

  const pages = Math.ceil(leads.length / PAGE);
  const at = Math.min(page, pages - 1);
  const shown = leads.slice(at * PAGE, at * PAGE + PAGE);
  const cell = "py-2 px-3 whitespace-nowrap";

  return (
    <div>
      <div className="overflow-x-auto -mx-4">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-border text-left text-ink">
              {COLS.map((c) => (
                <th key={c} className={`${cell} font-semibold`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="border-b border-border/70 hover:bg-bg">
                <td className={`${cell} font-medium`}>
                  <Link href={`/leads?open=${l.id}`} className="text-ink no-underline hover:text-accent hover:underline">
                    {l.name || "(no name)"}
                  </Link>
                </td>
                <td className={`${cell} text-ink tabular-nums`}>{l.phone}</td>
                <td className={`${cell} text-ink`}>{l.owner || <span className="text-muted">Unassigned</span>}</td>
                <td className={`${cell} text-ink tabular-nums`}>{day(l.date)}</td>
                <td className={`${cell} text-ink`}>{l.model}</td>
                <td className={cell}>
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <span className="w-2 h-2 rounded-full" style={{ background: statusChartColor(l.status) }} aria-hidden />
                    {l.status}
                  </span>
                </td>
                <td className={`${cell} text-accent`}>{l.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
        <span>
          Total Records <strong className="text-ink">{total}</strong>
          {total > leads.length && <span> · latest {leads.length} listed</span>}
        </span>
        <span className="flex items-center gap-2">
          <button type="button" className="btn-sm !px-2.5 disabled:opacity-40" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">
            ‹
          </button>
          <span className="tabular-nums text-ink">
            {at * PAGE + 1} to {at * PAGE + shown.length}
          </span>
          <button type="button" className="btn-sm !px-2.5 disabled:opacity-40" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">
            ›
          </button>
        </span>
      </div>
    </div>
  );
}
