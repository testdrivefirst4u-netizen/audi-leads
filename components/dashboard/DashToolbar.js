import { useEffect, useState } from "react";
import { FiRefreshCw } from "react-icons/fi";

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function ago(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/**
 * The dashboard's top line: greeting and date on the left; on the right the
 * period the charts cover (All time / This month / Last month / any month)
 * and when the numbers were last refreshed, with a refresh button.
 * `month` is "" for all time or "YYYY-MM", same as /api/stats?month=.
 */
export default function DashToolbar({ username, month, onMonthChange, updatedAt, onRefresh, refreshing }) {
  const [, tick] = useState(0);
  // Everything here that depends on the clock, timezone or locale (greeting,
  // date, month names) is worked out in the browser only: the page is first
  // rendered on the server, whose time zone and date format differ from the
  // viewer's, and React rejects a page whose text changes on load
  // ("Text content does not match server-rendered HTML"). Until then
  // `now` is null and those spots show a neutral placeholder.
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => {
      setNow(new Date());
      tick((n) => n + 1);
    }, 15000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return (
      <div className="dash2-toolbar">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] sm:text-[24px] font-bold text-ink leading-tight tracking-[-0.01em]">Welcome, {username}</h1>
          <p className="m-0 mt-0.5 text-[13px] text-muted">&nbsp;</p>
        </div>
      </div>
    );
  }

  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const options = [
    ["", "All time"],
    [thisMonth, "This month"],
    [lastMonth, "Last month"],
  ];
  const custom = month && month !== thisMonth && month !== lastMonth;
  // the 12 months before last month, newest first
  const earlierMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 2 - i, 1);
    return [monthKey(d), d.toLocaleDateString(undefined, { month: "long", year: "numeric" })];
  });

  return (
    <div className="dash2-toolbar">
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] sm:text-[24px] font-bold text-ink leading-tight tracking-[-0.01em]">
          {greeting(now)}, {username}
        </h1>
        <p className="m-0 mt-0.5 text-[13px] text-muted">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="chart-view-toggle !text-[12px]" role="tablist" aria-label="Period">
          {options.map(([key, label]) => (
            <button key={label} type="button" role="tab" aria-selected={month === key} className={month === key ? "is-active" : ""} onClick={() => onMonthChange(key)}>
              {label}
            </button>
          ))}
        </div>
        <select
          value={custom ? month : ""}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          aria-label="Pick another month"
          className={`h-8 rounded-lg border bg-card px-2 text-[12px] text-ink cursor-pointer ${custom ? "border-accent font-semibold" : "border-border"}`}
        >
          <option value="">More months…</option>
          {earlierMonths.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRefresh} className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-card text-[12px] text-muted cursor-pointer hover:text-ink" title="Refresh now">
          <FiRefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Updated {ago(updatedAt)}</span>
        </button>
      </div>
    </div>
  );
}
