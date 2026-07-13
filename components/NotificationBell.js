import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { BellIcon } from "./icons";
import Toast from "./Toast";
import { apiFetch } from "../lib/apiFetch";
import { playNotificationSound } from "../lib/notificationSound";

const POLL_MS = 10000;
const LAST_SEEN_KEY = "audi-leads:notifications-last-seen";

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [recentLeads, setRecentLeads] = useState([]);
  const [lastSeenAt, setLastSeenAt] = useState(null);
  const [open, setOpen] = useState(false);
  const [displayedLeads, setDisplayedLeads] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);
  const prevNewCountRef = useRef(null);
  const dropdownRef = useRef(null);

  // Initialize "last seen" once — defaults to now, so leads that already
  // existed before this feature shipped don't all show up as "new".
  useEffect(() => {
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    setLastSeenAt(stored ? new Date(stored) : new Date());
  }, []);

  useEffect(() => {
    if (!lastSeenAt) return;

    async function poll() {
      const res = await apiFetch("/api/leads/recent");
      if (!res.ok) return;
      const data = await res.json();
      const leads = data.leads || [];
      setRecentLeads(leads);

      const newCount = leads.filter((l) => new Date(l.createdAt) > lastSeenAt).length;
      if (prevNewCountRef.current !== null && newCount > prevNewCountRef.current) {
        const delta = newCount - prevNewCountRef.current;
        setToastMessage(`${delta} new lead${delta > 1 ? "s" : ""} added`);
        playNotificationSound();
      }
      prevNewCountRef.current = newCount;
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [lastSeenAt]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const newCount = lastSeenAt ? recentLeads.filter((l) => new Date(l.createdAt) > lastSeenAt).length : 0;

  function handleToggle() {
    if (!open) {
      // Snapshot what's new right now so the dropdown still shows them after
      // the badge clears, then mark everything as seen.
      setDisplayedLeads(recentLeads.filter((l) => new Date(l.createdAt) > lastSeenAt));
      const now = new Date();
      setLastSeenAt(now);
      localStorage.setItem(LAST_SEEN_KEY, now.toISOString());
      prevNewCountRef.current = 0;
    }
    setOpen((o) => !o);
  }

  function goToLead() {
    setOpen(false);
    router.push("/");
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-border bg-card text-muted cursor-pointer transition-colors duration-150 hover:bg-bg hover:text-ink"
        onClick={handleToggle}
        aria-label="Notifications"
      >
        <BellIcon />
        {newCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {newCount > 9 ? "9+" : newCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 w-80 bg-card border border-border rounded-xl shadow-dropdown z-50 overflow-hidden">
          <div className="px-4 py-3 text-[13px] font-bold text-ink border-b border-border">New Leads</div>
          {displayedLeads.length === 0 ? (
            <div className="text-center text-muted text-sm px-4 py-5">No new leads since your last visit.</div>
          ) : (
            <ul className="list-none m-0 p-0 max-h-80 overflow-y-auto">
              {displayedLeads.map((lead) => (
                <li
                  key={lead._id}
                  onClick={goToLead}
                  className="flex flex-col gap-0.5 px-4 py-2.5 border-b border-border last:border-b-0 cursor-pointer hover:bg-bg"
                >
                  <span className="text-[13px] font-semibold text-ink">{lead.name || "Unknown"}</span>
                  <span className="text-xs text-muted">
                    {lead.model} · {lead.phone || "no phone"}
                  </span>
                  <span className="text-[11px] text-muted">{timeAgo(lead.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
