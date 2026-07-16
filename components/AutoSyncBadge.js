import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";

const POLL_MS = 5000;

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

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const res = await apiFetch("/api/auto-sync-status");
      if (!res.ok || cancelled) return;
      setStatus(await res.json());
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Re-render every second purely to keep "Last Synced: Xs ago" ticking up
  // between polls, without needing to re-fetch that often.
  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!status) return null;

  return (
    <div
      className={`badge ${status.online ? "online" : "offline"}`}
      title={status.lastSyncTime ? `Last synced ${new Date(status.lastSyncTime).toLocaleString()}` : "No sync yet"}
    >
      <span className="dot" />
      <span className="text-[13px] font-medium">
        {status.online ? "Auto Sync Enabled" : "Reconnecting..."}
        {status.lastSyncTime && (
          <span className="text-muted font-normal ml-1.5">· Last Synced: {timeAgo(status.lastSyncTime)}</span>
        )}
      </span>
    </div>
  );
}
