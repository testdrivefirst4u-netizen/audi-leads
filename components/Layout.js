import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import MobileTabBar from "./MobileTabBar";
import OfflineBanner from "./OfflineBanner";
import { brandColorTriplets } from "../lib/color";
import { apiFetch } from "../lib/apiFetch";
import { loadAccountTheme } from "../lib/theme";
import { usePolling } from "../lib/usePolling";
import { startFollowUpReminders } from "../lib/followUpReminders";

// Same cadence as the other background pollers (Leads page, notification
// bell) — the sidebar badge doesn't need to be faster than that.
const FOLLOWUP_BADGE_POLL_MS = 20000;

// Distinct from any tenant's own brandColor (and from the platform default
// blue) — a violet "command center" accent shown only in the super admin's
// platform-wide view, so it's visually unmistakable which mode you're in:
// managing every company, vs. working inside one company's own branding.
const SUPER_ADMIN_ACCENT = "#7c3aed";

export default function Layout({ children, username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [followUpBadge, setFollowUpBadge] = useState(null);
  const [chatBadge, setChatBadge] = useState(null);
  const triplets = brandColorTriplets(role === "super_admin" ? SUPER_ADMIN_ACCENT : companyBrandColor);

  // The theme saved on this person's account (lib/theme.js) — once per page load.
  useEffect(() => loadAccountTheme(), []);

  // Daily desktop reminder of today's follow-ups, if turned on in the bell menu.
  useEffect(() => {
    if (role !== "super_admin") startFollowUpReminders();
  }, [role]);

  // Super admin has no Follow-ups nav item (it's a company working queue,
  // not a platform-monitoring view) and no single companyId to scope the
  // count to, so there's nothing to poll for. Paused in background tabs.
  usePolling(
    async () => {
      if (role === "super_admin") return;
      const [res, chatRes] = await Promise.all([apiFetch("/api/followups/count"), apiFetch("/api/chats/unread")]);
      if (res.ok) setFollowUpBadge(await res.json());
      if (chatRes.ok) setChatBadge(await chatRes.json());
    },
    FOLLOWUP_BADGE_POLL_MS,
    [role]
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    // .app-shell scopes the colour themes (globals.css "Themes", lib/theme.js)
    // to the CRM itself, so the login page keeps its own look.
    <div className="app-shell flex min-h-screen text-ink">
      {/* Overrides the platform-default accent CSS vars (see :root in
          globals.css) only when this company has its own brandColor set —
          scoped to this subtree so it never leaks across companies sharing
          one session-less render. */}
      {triplets && (
        <style jsx global>{`
          :root {
            --accent-rgb: ${triplets.accent};
            --accent-hover-rgb: ${triplets.hover};
            --accent-soft-rgb: ${triplets.soft};
            --accent-soft-dark-rgb: ${triplets.softDark};
          }
        `}</style>
      )}
      {/* Soft blurred color blobs behind the page, for every role — the
          only reason the glass sidebar (backdrop-blur) reads as glass at
          all is that there's something with depth/color behind it to blur;
          a flat page background would make the blur invisible. Uses the
          accent tokens above, so each company's blobs pick up its own
          brand color rather than a hardcoded one. */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-24 -left-24 w-[480px] h-[480px] rounded-full bg-accent/20 blur-[110px]" />
        <div className="absolute top-1/3 -left-32 w-[420px] h-[420px] rounded-full bg-blue-300/25 blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[380px] h-[380px] rounded-full bg-accent/10 blur-[100px]" />
      </div>
      <Sidebar
        role={role}
        companyName={companyName}
        companyLogoUrl={companyLogoUrl}
        followUpBadge={followUpBadge}
        chatBadge={chatBadge}
        onLogout={handleLogout}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      {/* No top padding: the TopBar is sticky and sits flush at the top. */}
      {/* bottom padding on phones clears the MobileTabBar */}
      <main className="flex-1 min-w-0 px-4 sm:px-8 pb-24 md:pb-8">
        <div className="max-w-[1400px] mx-auto">
          <TopBar
            role={role}
            username={username}
            companyName={companyName}
            companyLogoUrl={companyLogoUrl}
            onLogout={handleLogout}
          />
          {children}
        </div>
      </main>
      <OfflineBanner />
      <MobileTabBar role={role} followUpBadge={followUpBadge} chatBadge={chatBadge} onMore={() => setMobileNavOpen(true)} />
    </div>
  );
}
