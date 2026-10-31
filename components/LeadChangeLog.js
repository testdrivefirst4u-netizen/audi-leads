import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";

function describe(e) {
  if (e.type === "status") return <>Status <strong>{e.from}</strong> → <strong>{e.to}</strong></>;
  if (e.type === "assigned") return <>Reassigned <strong>{e.from}</strong> → <strong>{e.to}</strong></>;
  if (e.type === "edited") return <>Edited {e.to || "details"}</>;
  if (e.type === "created") return <>Added by hand{e.to ? ` · ${e.to}` : ""}</>;
  if (e.type === "deleted") return <>Deleted</>;
  return e.type;
}

/** A lead's change log (/api/leads/[id]/events): who changed its status, owner or details, and when. */
export default function LeadChangeLog({ leadId, companyId }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/leads/${leadId}/events${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`;
    apiFetch(url)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data) => !cancelled && setEvents(data.events || []))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [leadId, companyId]);

  if (!events) return <div className="hint">Loading…</div>;
  if (events.length === 0) return <div className="hint">No changes recorded yet. Status changes, reassignments and edits from now on show up here.</div>;
  return (
    <ul className="list-none m-0 p-0 flex flex-col">
      {events.map((e) => (
        <li key={e._id} className="flex items-baseline gap-3 py-2 border-b border-border last:border-b-0 text-[13px]">
          <span className="flex-1 min-w-0 text-ink">{describe(e)}</span>
          <span className="shrink-0 text-[11.5px] text-muted text-right">
            {e.by || "system"}
            <br />
            {new Date(e.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
