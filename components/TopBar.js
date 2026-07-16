import NotificationBell from "./NotificationBell";
import AutoSyncBadge from "./AutoSyncBadge";
import { MenuIcon } from "./icons";

export default function TopBar({ onMenuClick, role }) {
  // Neither is meaningful without a company context — super admin has none
  // of its own, so these would just poll and 403 repeatedly on every
  // company-scoped page it now visits (Dashboard/Leads/Reports).
  const showCompanyWidgets = role !== "super_admin";

  return (
    <div className="flex items-center justify-between mb-5">
      <button
        className="md:hidden flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-border bg-card text-muted cursor-pointer"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>
      {showCompanyWidgets && (
        <>
          <div className="hidden md:block">
            <AutoSyncBadge />
          </div>
          <NotificationBell />
        </>
      )}
    </div>
  );
}
