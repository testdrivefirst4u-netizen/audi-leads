import { useEffect, useState } from "react";
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
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon, superAdminVisible: true, group: "monitor" },
  { href: "/leads", label: "Leads", Icon: UsersIcon, superAdminVisible: true, group: "monitor" },
  { href: "/followups", label: "Follow-ups", Icon: BellIcon },
  { href: "/reports", label: "Reports", Icon: ReportIcon, superAdminVisible: true, group: "monitor" },
  { href: "/agents", label: "Agents", Icon: AgentIcon, adminOnly: true, superAdminVisible: true, group: "monitor" },
  // { href: "/settings", label: "Settings", Icon: SettingsIcon },
  { href: "/companies", label: "Companies", Icon: AgentIcon, superAdminOnly: true, group: "platform" },
  { href: "/import", label: "Import Leads", Icon: UploadIcon, superAdminOnly: true, group: "platform" },
];

// Only the super-admin nav is split into labeled groups — Platform actions
// (no company context needed) vs. the read-only per-company monitoring
// pages, which only mean anything once a company is picked via that page's
// own CompanySwitcher. A tenant's own nav has no such split, so it stays
// one flat list.
const SUPER_ADMIN_GROUPS = [
  { key: "platform", label: "Platform" },
  { key: "monitor", label: "Company View" },
];

const COLLAPSE_STORAGE_KEY = "broaddcast:sidebar-collapsed";

// One shared iOS/glassmorphism sidebar for every role — super admin and
// every tenant (admin/agent) alike. Branding (logo/name) and the accent
// color are the only things that differ per company (accent flows in via
// the --accent-* CSS custom properties Layout.js already sets per company,
// so this component never hardcodes a color): the glass surface, nav item
// treatment, collapse/tooltip behavior, and footer are identical everywhere.

function RoleBadge({ label, collapsed }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-accent/15 backdrop-blur-[12px] border border-accent/25 text-accent font-semibold ${
        collapsed ? "justify-center w-6 h-6 mx-auto" : "px-2.5 py-1 text-[11px] uppercase tracking-wider mt-3"
      }`}
      title={label}
    >
      <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0 shadow-[0_0_6px_rgba(124,58,237,0.7)]" />
      {!collapsed && label}
    </span>
  );
}

function NavItemLight({ href, label, Icon, active, collapsed, badgeCount, badgeUrgent, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group relative flex items-center rounded-[14px] text-[13.5px] font-medium no-underline transition-all duration-200 ${
        collapsed ? "justify-center h-11 w-11 mx-auto" : "gap-3 h-11 px-3"
      } ${
        active
          ? "bg-accent-soft/80 backdrop-blur-[16px] border border-accent/20 text-ink font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_1px_0_0_rgba(255,255,255,0.35),0_8px_20px_-6px_rgba(124,58,237,0.25)]"
          : "bg-transparent border border-transparent text-ink/65 hover:bg-white/55 hover:backdrop-blur-md hover:border-white/50 hover:text-ink"
      }`}
    >
      <Icon className={`shrink-0 transition-colors duration-200 ${active ? "text-accent" : "text-ink/35 group-hover:text-accent"}`} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badgeCount > 0 && (
        <span
          className={`min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center leading-none ${
            badgeUrgent ? "bg-danger" : "bg-ink/25"
          }`}
        >
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}

      {/* Collapsed-rail tooltip — only rendered (and only needs to exist)
          when there's no visible label doing this job already. */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 z-50">
          {label}
        </span>
      )}
    </Link>
  );
}

export default function Sidebar({ username, role, companyName, companyLogoUrl, followUpBadge, onLogout, open, onClose }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const brandName = isSuperAdmin ? "BroaddCast" : companyName || "Leads";
  const brandSubtitle = isSuperAdmin ? "Platform" : null;
  const brandLogo = isSuperAdmin ? "/icon.svg" : companyLogoUrl || "/audi-logo.png";
  const roleLabel = isSuperAdmin ? "Super Admin" : role === "admin" ? "Admin" : "Agent";

  const flatNavItems = NAV_ITEMS.filter((item) => !item.superAdminOnly && (!item.adminOnly || role === "admin"));

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`fixed md:sticky top-0 left-0 z-50 flex flex-col h-screen shrink-0 bg-white/70 backdrop-blur-[24px] backdrop-saturate-[1.6] border-r border-white/70 shadow-[0_20px_50px_rgba(30,35,70,0.10)] transition-[transform,width] duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-[72px]" : "w-60 lg:w-72"}`}
      >
        <div className={`relative border-b border-white/50 ${collapsed ? "px-3 py-4" : "px-5 py-4"}`}>
          <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "gap-2.5"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brandLogo}
              alt={brandName}
              className={`shrink-0 object-contain ${isSuperAdmin ? "rounded-[8px]" : ""} ${collapsed ? "h-8 w-8" : "h-9 w-9"}`}
            />
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="text-[15px] font-bold text-ink tracking-tight truncate">{brandName}</div>
                {brandSubtitle && <div className="text-[11px] font-medium text-muted">{brandSubtitle}</div>}
              </div>
            )}
            <button className="md:hidden ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Close menu">
              <CloseIcon />
            </button>
          </div>

          {isSuperAdmin && <RoleBadge label="Super Admin" collapsed={collapsed} />}

          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:flex items-center justify-center absolute -right-3 top-6 w-6 h-6 rounded-full bg-white/80 backdrop-blur-md border border-white/70 text-muted shadow-sm hover:text-accent hover:border-accent/40 transition-colors duration-200"
          >
            {collapsed ? <ChevronRightIcon width={13} height={13} /> : <ChevronLeftIcon width={13} height={13} />}
          </button>
        </div>

        {/* No overflow-y-auto here on purpose: setting either overflow axis
            to anything but visible forces the browser to clip BOTH axes
            (a CSS spec quirk — overflow-x can't stay visible once
            overflow-y is scrolling), which would cut off the collapsed-rail
            tooltips floating outside this column. The nav list is short
            enough to never need its own scroll. */}
        <nav className="flex flex-col flex-1 gap-1 px-3 py-3">
          {isSuperAdmin
            ? SUPER_ADMIN_GROUPS.map(({ key, label }, i) => {
                const items = NAV_ITEMS.filter((item) => item.group === key && (item.superAdminOnly || item.superAdminVisible));
                if (items.length === 0) return null;
                return (
                  <div key={key} className={i > 0 ? "mt-4" : ""}>
                    {!collapsed && (
                      <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</div>
                    )}
                    <div className="flex flex-col gap-1">
                      {items.map((item) => {
                        const active = router.pathname === item.href;
                        return (
                          <NavItemLight key={item.href} {...item} active={active} collapsed={collapsed} onClick={onClose} />
                        );
                      })}
                    </div>
                  </div>
                );
              })
            : flatNavItems.map((item) => {
                const active = router.pathname === item.href;
                // Due/overdue follow-ups need to be seen the moment an
                // agent opens the app, not just after they happen to click
                // into the Follow-ups page — matches the count already
                // reflected there.
                const badgeCount = item.href === "/followups" && followUpBadge ? followUpBadge.overdue + followUpBadge.today : 0;
                const badgeUrgent = item.href === "/followups" && followUpBadge?.overdue > 0;
                return (
                  <NavItemLight
                    key={item.href}
                    {...item}
                    active={active}
                    collapsed={collapsed}
                    badgeCount={badgeCount}
                    badgeUrgent={badgeUrgent}
                    onClick={onClose}
                  />
                );
              })}
        </nav>

        <div className={`${collapsed ? "px-3 py-3" : "px-3 py-3.5"}`}>
          {username && (
            <div
              className={`flex items-center rounded-2xl mb-2 bg-white/45 backdrop-blur-[16px] border border-white/50 shadow-sm ${
                collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-2.5 px-2.5 py-2"
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-hover text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]">
                {username.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="min-w-0 leading-tight">
                  <div className="text-[13px] font-semibold text-ink truncate">{username}</div>
                  <div className="text-[11px] text-muted">{roleLabel}</div>
                </div>
              )}
            </div>
          )}

          <button
            title={collapsed ? "Logout" : undefined}
            className={`group relative flex items-center w-full rounded-[14px] border border-transparent bg-transparent text-muted text-[13.5px] font-medium cursor-pointer transition-all duration-200 hover:bg-danger/10 hover:border-danger/15 hover:text-danger ${
              collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 h-10"
            }`}
            onClick={onLogout}
          >
            <LogoutIcon />
            {!collapsed && <span>Logout</span>}
            {collapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 z-50">
                Logout
              </span>
            )}
          </button>

          {!collapsed && (
            <div className="flex flex-col items-center gap-1.5 pt-3 mt-2">
              <span className="text-[11px] text-muted">Developed by</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/broaddcast-logo.svg" alt="BroaddCast Business Solutions" className="w-[130px] h-auto opacity-80" />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
