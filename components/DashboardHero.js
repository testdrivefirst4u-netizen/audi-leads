import Link from "next/link";
import Skeleton from "react-loading-skeleton";
import { bucketFollowUps } from "./FollowUpsCard";

const MAX_TASKS = 5;

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const pipelineCount = (stats, label) => stats?.pipeline?.find((p) => p.label === label)?.count ?? 0;

// Opens the lead on the Leads page with its details showing (same link the top bar search uses).
const leadHref = (f) => `/leads?q=${encodeURIComponent(f.phone || f.name || "")}&open=${f.leadId}`;

function timeLabel(date) {
  const d = new Date(date);
  return d.getHours() === 0 && d.getMinutes() === 0 ? null : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Top of the Dashboard: a greeting with today's key numbers, and the
 * follow-ups that need doing today (overdue first), each one click from the
 * lead itself. Uses the stats and follow-ups the Dashboard already loads.
 */
export default function DashboardHero({ username, stats, followUps, loading }) {
  const { overdue, today } = bucketFollowUps(followUps || []);
  const tasks = [...overdue.map((f) => ({ ...f, overdue: true })), ...today].slice(0, MAX_TASKS);
  const moreTasks = overdue.length + today.length - tasks.length;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const kpis = [
    { label: "New leads today", value: stats?.newLeadsToday ?? 0, href: "/leads" },
    { label: "Follow-ups due", value: overdue.length + today.length, href: "/followups", urgent: overdue.length > 0 },
    { label: "Test drive stage", value: pipelineCount(stats, "Test Drive"), href: "/leads" },
    { label: "Bookings", value: pipelineCount(stats, "Booking"), href: "/leads" },
  ];

  return (
    <section className="dash-hero mb-6" aria-label="Today">
      <div className="dash-hero-main">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/60">{dateLabel}</div>
        <h1 className="m-0 mt-1.5 text-[26px] sm:text-[30px] font-bold leading-tight text-white">
          {greeting()}, {username}
        </h1>
        <p className="m-0 mt-1.5 text-[14px] text-white/70">
          {loading
            ? "Getting today's numbers…"
            : overdue.length + today.length > 0
            ? `You have ${overdue.length + today.length} follow-up${overdue.length + today.length === 1 ? "" : "s"} to work today.`
            : "No follow-ups waiting — a good day to call new leads."}
        </p>
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="dash-hero-kpi">
              <span className="text-[11.5px] font-semibold text-white/65">{k.label}</span>
              <span className={`text-[26px] font-bold leading-none ${k.urgent ? "text-[#ffb4b6]" : "text-white"}`}>
                {loading ? <Skeleton width={36} baseColor="rgba(255,255,255,0.12)" highlightColor="rgba(255,255,255,0.25)" /> : k.value}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="dash-hero-tasks">
        <div className="flex items-center justify-between mb-2">
          <h2 className="m-0 text-[14px] font-bold text-ink">Today&apos;s tasks</h2>
          <Link href="/followups" className="text-[12.5px] font-semibold text-accent no-underline">
            All follow-ups
          </Link>
        </div>
        {loading ? (
          <Skeleton count={4} height={40} className="mb-1.5" />
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-6 text-[13px] text-muted">
            <span className="text-[22px]" aria-hidden="true">
              ✓
            </span>
            All caught up for today.
          </div>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {tasks.map((f) => (
              <li key={f.followUpId}>
                <Link href={leadHref(f)} className="dash-task">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${f.overdue ? "bg-danger" : "bg-warning"}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">{f.name || "Unnamed lead"}</span>
                    <span className="block text-[12px] text-muted truncate">{f.note || [f.model, f.phone].filter(Boolean).join(" · ") || "Follow up"}</span>
                  </span>
                  <span className={`shrink-0 text-[11.5px] font-semibold ${f.overdue ? "text-danger" : "text-muted"}`}>
                    {f.overdue ? "Overdue" : timeLabel(f.date) || "Today"}
                  </span>
                </Link>
              </li>
            ))}
            {moreTasks > 0 && (
              <li>
                <Link href="/followups" className="block px-2.5 pt-1.5 text-[12.5px] font-semibold text-accent no-underline">
                  +{moreTasks} more
                </Link>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
