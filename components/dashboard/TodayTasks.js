import Link from "next/link";
import Skeleton from "react-loading-skeleton";
import { bucketFollowUps } from "../FollowUpsCard";

const MAX_TASKS = 6;

// Opens the lead on the Leads page with its window showing (same link the top bar search uses).
const leadHref = (f) => `/leads?q=${encodeURIComponent(f.phone || f.name || "")}&open=${f.leadId}`;

// Follow-ups are picked as a day (stored at 12:00 UTC — see
// pages/api/leads/[id]/followups) or, from older data, at local midnight;
// neither carries a real time, so only show one when it's something else.
function timeLabel(date) {
  const d = new Date(date);
  const dateOnly = (d.getUTCHours() === 12 && d.getUTCMinutes() === 0) || (d.getHours() === 0 && d.getMinutes() === 0);
  return dateOnly ? null : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Today's follow-ups — overdue first — each one click from the lead itself. */
export default function TodayTasks({ followUps, loading }) {
  const { overdue, today } = bucketFollowUps(followUps || []);
  const tasks = [...overdue.map((f) => ({ ...f, overdue: true })), ...today].slice(0, MAX_TASKS);
  const more = overdue.length + today.length - tasks.length;

  if (loading) return <Skeleton count={5} height={40} className="mb-1.5" />;
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-8 text-[13px] text-muted">
        <span className="text-[22px] text-success" aria-hidden="true">
          ✓
        </span>
        All caught up for today.
      </div>
    );
  }
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
      {tasks.map((f) => (
        <li key={f.followUpId}>
          <Link href={leadHref(f)} className="dash-task">
            <span className={`w-2 h-2 rounded-full shrink-0 ${f.overdue ? "bg-danger" : "bg-warning"}`} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold text-ink truncate">{f.name || "Unnamed lead"}</span>
              <span className="block text-[12px] text-muted truncate">{f.note || [f.model, f.phone].filter(Boolean).join(" · ") || "Follow up"}</span>
            </span>
            <span className={`shrink-0 text-[11.5px] font-semibold ${f.overdue ? "text-danger" : "text-muted"}`}>{f.overdue ? "Overdue" : timeLabel(f.date) || "Today"}</span>
          </Link>
        </li>
      ))}
      {more > 0 && (
        <li>
          <Link href="/followups" className="block px-2.5 pt-1.5 text-[12.5px] font-semibold text-accent no-underline">
            +{more} more
          </Link>
        </li>
      )}
    </ul>
  );
}
