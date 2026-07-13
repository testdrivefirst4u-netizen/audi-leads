import NotificationBell from "./NotificationBell";
import { MenuIcon } from "./icons";

export default function TopBar({ onMenuClick }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <button
        className="md:hidden flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-border bg-card text-muted cursor-pointer"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>
      <div className="hidden md:block" />
      <NotificationBell />
    </div>
  );
}
