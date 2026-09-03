import NotificationBell from "./NotificationBell";
import AutoSyncBadge from "./AutoSyncBadge";
import ProfileMenu from "./ProfileMenu";
import { MenuIcon } from "./icons";

export default function TopBar({ onMenuClick, role, username, companyName, companyLogoUrl, onLogout }) {
  // Neither is meaningful without a company context — super admin has none
  // of its own, so these would just poll and 403 repeatedly on every
  // company-scoped page it now visits (Dashboard/Leads/Reports).
  const showCompanyWidgets = role !== "super_admin";

  return (
    <div className="flex items-center justify-between gap-2 mb-5">
      <button
        className="md:hidden flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-border bg-card text-muted cursor-pointer"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>
      <div className="flex items-center gap-2 ml-auto">
        {showCompanyWidgets && (
          <>
            <div className="hidden md:block">
              <AutoSyncBadge />
            </div>
            <NotificationBell />
          </>
        )}
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
    </div>
  );
}
