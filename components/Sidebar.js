import Link from "next/link";
import { useRouter } from "next/router";
import {
  DashboardIcon,
  UsersIcon,
  BellIcon,
  ReportIcon,
  AgentIcon,
  SettingsIcon,
  LogoutIcon,
  CloseIcon,
  UploadIcon,
} from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon, superAdminVisible: true },
  { href: "/leads", label: "Leads", Icon: UsersIcon, superAdminVisible: true },
  { href: "/followups", label: "Follow-ups", Icon: BellIcon },
  { href: "/reports", label: "Reports", Icon: ReportIcon, superAdminVisible: true },
  { href: "/agents", label: "Agents", Icon: AgentIcon, adminOnly: true },
  // { href: "/settings", label: "Settings", Icon: SettingsIcon },
  { href: "/import", label: "Import Leads", Icon: UploadIcon, superAdminOnly: true },
  { href: "/companies", label: "Companies", Icon: AgentIcon, superAdminOnly: true },
];

export default function Sidebar({ username, role, companyName, companyLogoUrl, onLogout, open, onClose }) {
  const router = useRouter();
  const brandName = role === "super_admin" ? "Broaddcast Platform" : companyName || "Leads";
  const brandLogo = role === "super_admin" ? "/broaddcast-logo.svg" : companyLogoUrl || "/audi-logo.png";
  // Super admin gets Dashboard/Leads/Reports too (read-only monitoring across
  // every company via the CompanySwitcher on those pages) plus its own
  // superAdminOnly items (Import Leads, Companies) — but never Follow-ups or
  // Agents, which stay company-admin-only management tools.
  const navItems = NAV_ITEMS.filter((item) =>
    role === "super_admin"
      ? item.superAdminOnly || item.superAdminVisible
      : !item.superAdminOnly && (!item.adminOnly || role === "admin")
  );

  return (
    <>
      {/* Backdrop — mobile only, closes the drawer on tap outside it. */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`fixed md:sticky top-0 left-0 z-50 flex flex-col h-screen w-60 shrink-0 bg-sidebar text-sidebar-text transition-transform duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-[22px] text-white text-base font-bold tracking-wide border-b border-white/[0.08] mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandLogo} alt={brandName} className="h-[26px] w-auto object-contain" />
          <span className="flex-1">{brandName}</span>
          <button className="md:hidden text-sidebar-text hover:text-white" onClick={onClose} aria-label="Close menu">
            <CloseIcon />
          </button>
        </div>

        <nav className="flex flex-col flex-1 gap-1 px-3 py-2">
          {navItems.map(({ href, label, Icon }) => {
            const active = router.pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
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
    </>
  );
}