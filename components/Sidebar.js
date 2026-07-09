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
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/audi-logo.png" alt="Audi" className="sidebar-brand-logo" />
        <span>Audi Leads</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = router.pathname === href;
          return (
            <Link key={href} href={href} className={`sidebar-link ${active ? "active" : ""}`}>
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {username && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {username.charAt(0).toUpperCase()}
            </div>
            <span>{username}</span>
          </div>
        )}

        <button className="sidebar-logout" onClick={onLogout}>
          <LogoutIcon />
          <span>Logout</span>
        </button>

        <div className="sidebar-credit">
          <span>Developed by</span>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/broaddcast-logo.svg"
            alt="Broaddcast"
            className="sidebar-credit-logo"
          />
        </div>
      </div>
    </aside>
  );
}