import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { brandColorTriplets } from "../lib/color";
import { apiFetch } from "../lib/apiFetch";

// Same cadence as the other background pollers (Leads page, notification
// bell) — the sidebar badge doesn't need to be faster than that.
const FOLLOWUP_BADGE_POLL_MS = 20000;

export default function Layout({ children, username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [followUpBadge, setFollowUpBadge] = useState(null);
  const triplets = brandColorTriplets(companyBrandColor);

  useEffect(() => {
    // Super admin has no Follow-ups nav item (it's a company working queue,
    // not a platform-monitoring view) and no single companyId to scope the
    // count to, so there's nothing to poll for.
    if (role === "super_admin") return;

    let cancelled = false;
    async function poll() {
      const res = await apiFetch("/api/followups/count");
      if (!res.ok || cancelled) return;
      setFollowUpBadge(await res.json());
    }
    poll();
    const interval = setInterval(poll, FOLLOWUP_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
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
          }
        `}</style>
      )}
      <Sidebar
        username={username}
        role={role}
        companyName={companyName}
        companyLogoUrl={companyLogoUrl}
        followUpBadge={followUpBadge}
        onLogout={handleLogout}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <main className="flex-1 min-w-0 p-4 sm:p-8">
        <div className="max-w-[1400px] mx-auto">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} role={role} />
          {children}
        </div>
      </main>
    </div>
  );
}
