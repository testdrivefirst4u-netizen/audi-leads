import { useState } from "react";
import { useToast } from "./ToastProvider";
import { apiFetch } from "../lib/apiFetch";
import { LEAD_STATUSES, statusColor } from "../lib/leadFields";

// Board view of the Leads page: one column per status, a card per lead. Drag
// a card to another column to change its status (the same PATCH the lead
// details' status menu uses — it also resolves any follow-up already due);
// click a card to open its details. Shows the leads currently loaded on the
// Leads page (its filters, search and page apply), so the counts are "on
// this page", not company totals.
const DRAG_TYPE = "application/x-broaddcast-lead";

export default function LeadsBoard({ leads, statuses, readOnly, manageCompanyId, onOpen, onMoved }) {
  const toast = useToast();
  const columns = statuses && statuses.length > 0 ? statuses : LEAD_STATUSES;
  const [dragId, setDragId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const [moving, setMoving] = useState(null);

  const byStatus = Object.fromEntries(columns.map((s) => [s, []]));
  for (const lead of leads) {
    const s = lead.status || "New";
    (byStatus[s] || (byStatus[s] = [])).push(lead);
  }
  // a status outside the company's current list still gets its own column
  const allColumns = Object.keys(byStatus);

  async function moveTo(leadId, status) {
    const lead = leads.find((l) => l._id === leadId);
    if (!lead || (lead.status || "New") === status) return;
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
        const items = byStatus[status];
        const isOver = overColumn === status;
        return (
          <section
            key={status}
            role="listitem"
            aria-label={`${status}: ${items.length}`}
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
              <span className="ml-auto rounded-full bg-card border border-border px-2 text-[11px] font-bold text-muted">{items.length}</span>
            </header>
            <div className="flex flex-col gap-2 px-2.5 pb-3 min-h-[80px] max-h-[62vh] overflow-y-auto">
              {items.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">{readOnly ? "No leads" : "Drop a lead here"}</div>}
              {items.map((lead) => (
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
            </div>
          </section>
        );
      })}
    </div>
  );
}
