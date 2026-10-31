import { useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { usePolling } from "../lib/usePolling";

// Renders on every page (via TopBar) for every logged-in user — sync itself
// only runs once a day on Vercel, so this can't go stale in any way that
// matters at 20s.
const POLL_MS = 20000;

function timeAgo(date) {
  if (!date) return null;
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Small, always-visible replacement for the old admin-only Sync Status card —
// every company member sees this, not just the admin, since it's just
// reassurance that background sync is alive, not sensitive config.
export default function AutoSyncBadge() {
  const [status, setStatus] = useState(null);
  const [, forceTick] = useState(0);

  // Paused while the tab is in the background (lib/usePolling.js).
  usePolling(async () => {
    const res = await apiFetch("/api/auto-sync-status");
    if (res.ok) setStatus(await res.json());
  }, POLL_MS);

  // Re-render now and then to keep "· 5m ago" current between polls — every
  // 15s is plenty for a label that mostly reads in minutes.
  usePolling(() => forceTick((n) => n + 1), 15000);

  if (!status) return null;

  // Calm by default: green "Synced" while the last success is within the
  // expected window, amber "Sync overdue" only once it's really late (the API
  // allows 3× the company's interval), and a neutral "Not synced yet" for a
  // company with no successful sync at all (e.g. no sheet connected) — none
  // of these is a connection problem, so nothing says "Reconnecting".
  const state = !status.lastSyncTime ? "idle" : status.online ? "online" : "overdue";
  const label = state === "online" ? "Synced" : state === "overdue" ? "Sync overdue" : "Not synced yet";

  return (
    <div
      className={`badge ${state} rounded-full border border-border bg-card px-3 h-9`}
      title={status.lastSyncTime ? `Last successful sync: ${new Date(status.lastSyncTime).toLocaleString()}` : "No successful sync yet"}
    >
      <span className="dot" />
      <span className="text-[12.5px] font-medium text-ink">
        {label}
        {status.lastSyncTime && <span className="text-muted font-normal ml-1">· {timeAgo(status.lastSyncTime)}</span>}
      </span>
    </div>
  );
}
