import Link from "next/link";

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
    <Link href="/followups" style={{ textDecoration: "none" }}>
      <div className="status-grid" style={{ marginBottom: 0 }}>
        <div className="card">
          <div className="label">Overdue Follow-ups</div>
          <div className="value" style={{ color: overdue.length ? "#e5484d" : undefined }}>
            {overdue.length}
          </div>
        </div>
        <div className="card">
          <div className="label">Due Today</div>
          <div className="value" style={{ color: today.length ? "#e8b339" : undefined }}>
            {today.length}
          </div>
        </div>
        <div className="card">
          <div className="label">Upcoming</div>
          <div className="value">{upcoming.length}</div>
        </div>
      </div>
    </Link>
  );
}
