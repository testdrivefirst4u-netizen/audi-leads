import Link from "next/link";
import { useRouter } from "next/router";
import { DashboardIcon, UsersIcon, BellIcon, ReportIcon, SettingsIcon, LogoutIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon },
  { href: "/leads", label: "Leads", Icon: UsersIcon },
  { href: "/followups", label: "Follow-ups", Icon: BellIcon },
  { href: "/reports", label: "Reports", Icon: ReportIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export default function Sidebar({ username, onLogout }) {
  const router = useRouter();

  return (
    <aside className="w-60 shrink-0 bg-sidebar text-sidebar-text flex flex-col sticky top-0 h-screen">
      <div className="flex items-center gap-2.5 px-5 py-[22px] text-white text-base font-bold tracking-wide border-b border-white/[0.08] mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/audi-logo.png" alt="Audi" className="h-[26px] w-auto object-contain" />
        <span>Audi Leads</span>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2 flex-1">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = router.pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg no-underline text-sm font-medium transition-colors duration-150 ${
                active
                  ? "bg-sidebar-active text-white before:absolute before:content-[''] before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent"
                  : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/[0.08]">
        {username && (
          <div className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-white mb-1.5">
            <div className="w-[26px] h-[26px] rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0">
              {username.charAt(0).toUpperCase()}
            </div>
            <span>{username}</span>
          </div>
        )}

        <button
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border-none bg-transparent text-sidebar-text text-sm font-medium cursor-pointer transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          onClick={onLogout}
        >
          <LogoutIcon />
          <span>Logout</span>
        </button>

        <div className="flex flex-col items-center gap-2 pt-3.5 px-3 pb-1 text-sm text-sidebar-text tracking-wide">
          <span>Developed by</span>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/broaddcast-logo.svg"
            alt="Broaddcast"
            className="w-[180px] h-auto block brightness-0 invert opacity-[0.85]"
          />
        </div>
      </div>
    </aside>
  );
}