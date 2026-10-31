// A once-a-day desktop notification — "3 follow-ups due today, 1 overdue" —
// shown from REMIND_AT on any day the CRM is open, even in a background tab
// (browsers still run a once-a-minute timer there). Turned on per browser
// from the bell menu (NotificationBell), which asks for the browser's
// permission; clicking the notification opens Follow-ups.
//
// Follow-ups are picked as a day, not a time, so a daily summary is the
// honest reminder — not "call at 4:30".

import { apiFetch } from "./apiFetch";

const REMIND_AT = { hour: 9, minute: 30 };
const LAST_KEY = "broaddcast:followup-reminder-day";
const CHECK_MS = 60 * 1000;

export const remindersSupported = () => typeof window !== "undefined" && "Notification" in window;
export const remindersOn = () => remindersSupported() && Notification.permission === "granted";

export async function turnOnReminders() {
  if (!remindersSupported()) return "unsupported";
  const result = await Notification.requestPermission();
  if (result === "granted") checkNow(true);
  return result;
}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

async function checkNow(force = false) {
  if (!remindersOn()) return;
  const now = new Date();
  const due = now.getHours() > REMIND_AT.hour || (now.getHours() === REMIND_AT.hour && now.getMinutes() >= REMIND_AT.minute);
  let last = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {}
  if (!force && (!due || last === today())) return;

  const res = await apiFetch("/api/followups/count");
  if (!res.ok) return;
  const { overdue = 0, today: dueToday = 0 } = await res.json();
  try {
    localStorage.setItem(LAST_KEY, today());
  } catch {}
  if (overdue + dueToday === 0) return;

  const parts = [];
  if (dueToday) parts.push(`${dueToday} due today`);
  if (overdue) parts.push(`${overdue} overdue`);
  const n = new Notification("Follow-ups to work today", {
    body: `${parts.join(", ")} — open Follow-ups to start calling.`,
    tag: "broaddcast-followups", // replaces, never stacks
    icon: "/icon.svg",
  });
  n.onclick = () => {
    window.focus();
    window.location.href = "/followups";
    n.close();
  };
}

// Started once per page load by Layout (company users only).
let started = false;
export function startFollowUpReminders() {
  if (started || !remindersSupported()) return;
  started = true;
  checkNow();
  setInterval(checkNow, CHECK_MS);
}
