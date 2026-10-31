import { useEffect, useState } from "react";
import { useToast } from "./ToastProvider";
import { apiFetch } from "../lib/apiFetch";
import { LEAD_STATUSES, statusColor } from "../lib/leadFields";

const DRAG_TYPE = "application/x-broaddcast-lead";
const COLUMN_PAGE = 30;

// Board view of the Leads page: one column per status, a card per lead. Drag
// a card to another column to change its status (the same PATCH the lead
// window's status menu uses — it also resolves any follow-up already due);
// click a card to open it.
//
// With `loadColumn` (the Leads page passes it), each column loads its own
// leads across the whole result set — the page's filters, any page — so the
// counts are real totals, and "Load more" fetches the next batch. Without
// it, the board just groups the `leads` it's given.
export default function LeadsBoard({ leads, statuses, readOnly, manageCompanyId, onOpen, onMoved, loadColumn, filterKey }) {
  const toast = useToast();
  const columns = statuses && statuses.length > 0 ? statuses : LEAD_STATUSES;
  const [dragId, setDragId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const [moving, setMoving] = useState(null);
  // remote mode: { [status]: { leads, total, limit, loading } }
  const [remote, setRemote] = useState({});

  async function fetchColumn(status, limit) {
    setRemote((r) => ({ ...r, [status]: { ...(r[status] || { leads: [], total: 0 }), limit, loading: true } }));
    const { leads: rows, total } = await loadColumn(status, limit);
    setRemote((r) => ({ ...r, [status]: { leads: rows, total, limit, loading: false } }));
  }

  useEffect(() => {
    if (!loadColumn) return;
    setRemote({});
    columns.forEach((status) => fetchColumn(status, COLUMN_PAGE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadColumn, filterKey, columns.join("|")]);

  // What each column shows: its own fetched leads (remote), or the given leads grouped.
  const byStatus = {};
  if (loadColumn) {
    for (const s of columns) byStatus[s] = remote[s] || { leads: [], total: 0, loading: true };
  } else {
    for (const s of columns) byStatus[s] = { leads: [], total: 0 };
    for (const lead of leads) {
      const s = lead.status || "New";
      if (!byStatus[s]) byStatus[s] = { leads: [], total: 0 }; // a status outside the company's list still gets a column
      byStatus[s].leads.push(lead);
      byStatus[s].total += 1;
    }
  }
  const allColumns = Object.keys(byStatus);
  const findLead = (id) => allColumns.flatMap((s) => byStatus[s].leads).find((l) => l._id === id);

  async function moveTo(leadId, status) {
    const lead = findLead(leadId);
    const from = lead?.status || "New";
    if (!lead || from === status) return;
    setMoving(leadId);
    try {
      const base = `/api/leads/${leadId}/status`;
      const url = manageCompanyId ? `${base}?companyId=${encodeURIComponent(manageCompanyId)}` : base;
      const res = await apiFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't change the status");
      const data = await res.json();
      if (loadColumn) {
        // move the card between the two columns right away, totals included
        setRemote((r) => {
          const next = { ...r };
          if (next[from]) next[from] = { ...next[from], leads: next[from].leads.filter((l) => l._id !== leadId), total: Math.max(0, next[from].total - 1) };
          if (next[status]) next[status] = { ...next[status], leads: [data.lead, ...next[status].leads], total: next[status].total + 1 };
          return next;
        });
      }
      onMoved?.(data.lead);
      toast(`${lead.name || "Lead"} moved to ${status}`);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto px-5 pb-5 pt-1 snap-x" role="list" aria-label="Leads by status">
      {allColumns.map((status) => {
        const { text } = statusColor(status);
        const col = byStatus[status];
        const isOver = overColumn === status;
        return (
          <section
            key={status}
            role="listitem"
            aria-label={`${status}: ${col.total}`}
            className={`snap-start shrink-0 w-[260px] flex flex-col rounded-2xl border bg-bg/70 transition-colors ${isOver ? "border-accent bg-accent/5" : "border-border"}`}
            onDragOver={(e) => {
              if (readOnly || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverColumn(null);
              // the lead's id travels with the drag itself, so the drop doesn't depend on React state having caught up
              const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
              if (id) moveTo(id, status);
              setDragId(null);
            }}
          >
            <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: text }} />
              <span className="text-[12.5px] font-bold text-ink truncate">{status}</span>
              <span className="ml-auto rounded-full bg-card border border-border px-2 text-[11px] font-bold text-muted">{col.loading && !col.leads.length ? "…" : col.total}</span>
            </header>
            <div className="flex flex-col gap-2 px-2.5 pb-3 min-h-[80px] max-h-[62vh] overflow-y-auto">
              {!col.loading && col.leads.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">{readOnly ? "No leads" : "Drop a lead here"}</div>
              )}
              {col.loading && col.leads.length === 0 && <div className="h-16 rounded-xl bg-card/60 animate-pulse" />}
              {col.leads.map((lead) => (
                <button
                  key={lead._id}
                  type="button"
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    setDragId(lead._id);
                    e.dataTransfer.setData(DRAG_TYPE, lead._id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverColumn(null);
                  }}
                  onClick={() => onOpen(lead)}
                  className={`w-full text-left rounded-xl border border-border bg-card px-3 py-2.5 shadow-card cursor-pointer transition-[box-shadow,opacity] hover:shadow-card-hover ${
                    dragId === lead._id || moving === lead._id ? "opacity-50" : ""
                  }`}
                >
                  <div className="text-[13px] font-semibold text-ink truncate">{lead.name || "Unnamed lead"}</div>
                  <div className="mt-0.5 text-[12px] text-muted truncate">{[lead.canonicalModel || lead.model, lead.phone].filter(Boolean).join(" · ") || "—"}</div>
                  {lead.assignedTo?.name && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-muted">
                      <span className="w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">{lead.assignedTo.name[0]?.toUpperCase()}</span>
                      {lead.assignedTo.name}
                    </div>
                  )}
                </button>
              ))}
              {loadColumn && col.leads.length < col.total && (
                <button type="button" className="btn-sm self-center" disabled={col.loading} onClick={() => fetchColumn(status, (col.limit || COLUMN_PAGE) + COLUMN_PAGE)}>
                  {col.loading ? "Loading…" : `Load more (${col.total - col.leads.length})`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
