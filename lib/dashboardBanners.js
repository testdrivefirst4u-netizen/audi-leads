// Shared "snooze until tomorrow" logic for DueTodayBanner.js/HotLeadsCard.js.
// Dismissing a banner doesn't resolve the underlying overdue-follow-ups/hot-
// leads condition — it just stops nagging about it for the rest of today,
// same as any "seen it, remind me later" dismiss. Per-browser (localStorage),
// not per-account, and resets automatically at midnight since the stored
// value is compared against today's own date string.
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local storage compare only
}

export function isBannerDismissedToday(bannerId) {
  try {
    return localStorage.getItem(`dash-banner-dismissed:${bannerId}`) === todayKey();
  } catch {
    return false; // localStorage can throw (private mode, blocked storage) — never let that hide a real alert
  }
}

export function dismissBannerToday(bannerId) {
  try {
    localStorage.setItem(`dash-banner-dismissed:${bannerId}`, todayKey());
  } catch {
    // Non-critical — worst case the banner just doesn't stay dismissed.
  }
}
