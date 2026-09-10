import Link from "next/link";
import { ChevronRightIcon } from "./icons";

function startOfDay(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function bucketFollowUps(followUps) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const buckets = { overdue: [], today: [], upcoming: [] };
  for (const f of followUps) {
    const day = startOfDay(f.date);
    if (day < today) buckets.overdue.push(f);
    else if (day < tomorrow) buckets.today.push(f);
    else buckets.upcoming.push(f);
  }
  return buckets;
}

export default function FollowUpsCard({ followUps }) {
  const { overdue, today, upcoming } = bucketFollowUps(followUps || []);

  return (
    <Link href="/followups" className="group block no-underline">
      <div className="dash-panel mb-0 transition-[box-shadow,transform] duration-150 group-hover:-translate-y-px group-hover:shadow-[0_14px_34px_rgba(20,30,60,0.09)]">
        <div className="mb-3.5 flex items-center justify-between">
          <h3 className="m-0">Follow-ups</h3>
          <span className="flex items-center gap-0.5 text-[12.5px] font-semibold text-accent">
            View all
            <ChevronRightIcon width={14} height={14} />
          </span>
        </div>
        <div className="dash-stat-grid mb-0">
          <div className="dash-card" style={{ "--dash-accent": "#e5484d" }}>
            <div className="label">Overdue Follow-ups</div>
            <div className="value" style={{ color: overdue.length ? "#e5484d" : undefined }}>
              {overdue.length}
            </div>
          </div>
          <div className="dash-card" style={{ "--dash-accent": "#e8b339" }}>
            <div className="label">Due Today</div>
            <div className="value" style={{ color: today.length ? "#e8b339" : undefined }}>
              {today.length}
            </div>
          </div>
          <div className="dash-card" style={{ "--dash-accent": "#94a3b8" }}>
            <div className="label">Upcoming</div>
            <div className="value">{upcoming.length}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
