import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { BellIcon } from "./icons";
import Toast from "./Toast";
import { apiFetch } from "../lib/apiFetch";

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
    <div className="notification-bell" ref={dropdownRef}>
      <button className="bell-button" onClick={handleToggle} aria-label="Notifications">
        <BellIcon />
        {newCount > 0 && <span className="bell-badge">{newCount > 9 ? "9+" : newCount}</span>}
      </button>

      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-header">New Leads</div>
          {displayedLeads.length === 0 ? (
            <div className="empty-state" style={{ padding: "20px 16px" }}>
              No new leads since your last visit.
            </div>
          ) : (
            <ul className="bell-list">
              {displayedLeads.map((lead) => (
                <li key={lead._id} onClick={goToLead}>
                  <span className="bell-list-name">{lead.name || "Unknown"}</span>
                  <span className="bell-list-meta">
                    {lead.model} · {lead.phone || "no phone"}
                  </span>
                  <span className="bell-list-time">{timeAgo(lead.createdAt)}</span>
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
