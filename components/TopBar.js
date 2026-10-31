import { useEffect, useState } from "react";
import NotificationBell from "./NotificationBell";
import AutoSyncBadge from "./AutoSyncBadge";
import ProfileMenu from "./ProfileMenu";
import GlobalSearch from "./GlobalSearch";
import CompanyPicker from "./CompanyPicker";
import QuickAddLead from "./QuickAddLead";

export default function TopBar({ role, username, companyName, companyLogoUrl, onLogout }) {
  // Neither is meaningful without a company context — super admin has none
  // of its own, so these would just poll and 403 repeatedly on every
  // company-scoped page it now visits (Dashboard/Leads/Reports).
  const showCompanyWidgets = role !== "super_admin";

  // Pinned to the top while the page scrolls; it picks up a hairline border
  // and a soft shadow only once there's content scrolling underneath it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 sm:py-4 mb-5 sm:mb-6 flex items-center gap-3 bg-bg/80 backdrop-blur-xl backdrop-saturate-150 border-b transition-[border-color,box-shadow] duration-200 ${
        scrolled ? "border-border shadow-[0_8px_24px_-12px_rgba(16,24,40,0.18)]" : "border-transparent"
      }`}
    >
      {/* Super admin: which company the "Company View" pages show — picked
          once here, every page follows it (lib/viewCompany.js). */}
      {!showCompanyWidgets && <CompanyPicker />}

      {/* On phones the full menu opens from "More" in the MobileTabBar. */}
      <div className="flex-1 min-w-0">
        <GlobalSearch role={role} />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <QuickAddLead role={role} />
        {showCompanyWidgets && (
          <>
            <div className="hidden lg:block">
              <AutoSyncBadge />
            </div>
            <NotificationBell />
          </>
        )}
        <span className="hidden sm:block w-px h-7 bg-border mx-1" aria-hidden="true" />
        {/* Super admin gets the platform's own icon.svg (same mark as the
            sidebar header) instead of a company logo — it has a solid black
            background baked in, so unlike Sidebar's "/audi-logo.png"
            fallback (white-on-transparent, invisible on a light circle)
            it's never invisible here. A tenant with no logo of its own just
            gets the initial-letter avatar, the standard expected fallback. */}
        <ProfileMenu
          username={username}
          role={role}
          companyName={role === "super_admin" ? null : companyName}
          companyLogoUrl={role === "super_admin" ? "/icon.svg" : companyLogoUrl}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
