import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { FiBriefcase } from "react-icons/fi";
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
  UserIcon,
  ChecklistIcon,
  MetaIcon,
  ActivityIcon,
  MegaphoneIcon,
  ChatIcon,
  CarIcon,
} from "./icons";
import BcMark from "./BcMark";
import { getViewCompany, VIEW_COMPANY_EVENT } from "../lib/viewCompany";

const ModelsIcon = (props) => <CarIcon width={18} height={18} {...props} />;

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon, superAdminVisible: true, group: "monitor" },
  { href: "/leads", label: "Leads", Icon: UsersIcon, superAdminVisible: true, group: "monitor" },
  { href: "/catalog", label: "Models", Icon: ModelsIcon, superAdminVisible: true, group: "monitor" },
  { href: "/followups", label: "Follow-ups", Icon: BellIcon },
  { href: "/chats", label: "Chats", Icon: ChatIcon, superAdminVisible: true, group: "monitor" },
  { href: "/reports", label: "Reports", Icon: ReportIcon, superAdminVisible: true, group: "monitor" },
  { href: "/agents", label: "Agents", Icon: AgentIcon, adminOnly: true, superAdminVisible: true, group: "monitor" },
  { href: "/campaigns", label: "Campaigns", Icon: MegaphoneIcon, adminOnly: true, superAdminVisible: true, group: "monitor" },

  // { href: "/settings", label: "Settings", Icon: SettingsIcon },
  { href: "/companies", label: "Companies", Icon: AgentIcon, superAdminOnly: true, group: "platform" },
  { href: "/import", label: "Import Leads", Icon: UploadIcon, superAdminOnly: true, group: "platform" },
  { href: "/import-audit", label: "Import Audit", Icon: ChecklistIcon, superAdminOnly: true, group: "platform" },
  { href: "/meta-integration", label: "Meta Lead Ads", Icon: MetaIcon, superAdminOnly: true, group: "platform" },
  { href: "/login-activity", label: "Login Activity", Icon: ActivityIcon, superAdminOnly: true, group: "platform" },
  { href: "/account", label: "Account", Icon: UserIcon, superAdminOnly: true, group: "platform" },
];

// Only the super-admin nav is split into labeled groups — Platform actions
// (no company context needed) vs. the read-only per-company monitoring
// pages, which only mean anything once a company is picked in the top bar
// (CompanyPicker). A tenant's own nav has no such split, so it stays
// one flat list.
const SUPER_ADMIN_GROUPS = [
  { key: "platform", label: "Platform" },
  { key: "monitor", label: "Company View" },
];

/** The pages this role can open — also used by the top bar search (GlobalSearch) for its "Go to" shortcuts. */
export function navItemsFor(role) {
  if (role === "super_admin") return NAV_ITEMS.filter((item) => item.superAdminOnly || item.superAdminVisible);
  return NAV_ITEMS.filter((item) => !item.superAdminOnly && (!item.adminOnly || role === "admin"));
}

const COLLAPSE_STORAGE_KEY = "broaddcast:sidebar-collapsed";


// One shared sidebar for every role — super admin and every tenant
// (admin/agent) alike. Its colours come from the active theme (the .sb-*
// classes and --sb-* variables in globals.css "Themes"), and the accent
// from the --accent-* properties Layout.js sets per company, so this
// component never hardcodes a color. Branding (logo/name) is the only other
// thing that differs per company.

function RoleBadge({ label, collapsed }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent font-semibold ${
        collapsed ? "justify-center w-6 h-6 mx-auto mt-2" : "px-2.5 py-1 text-[11px] uppercase tracking-wider mt-3"
      }`}
      title={label}
    >
      <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0 shadow-[0_0_6px_rgb(var(--accent-rgb)/0.8)]" />
      {!collapsed && label}
    </span>
  );
}

function NavItem({ href, label, Icon, active, collapsed, badgeCount, badgeUrgent, onClick, tip }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      {...tip(label)}
      aria-current={active ? "page" : undefined}
      className={`sb-item group ${active ? "is-active" : ""} ${collapsed ? "justify-center h-11 w-11 mx-auto" : "gap-3 h-11 px-3"}`}
    >
      <Icon className="shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badgeCount > 0 && (
        <span className={`sb-badge ${badgeUrgent ? "!bg-danger" : ""} ${collapsed ? "absolute -top-1 -right-1" : ""}`}>
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}
    </Link>
  );
}

/** Initials for a company without an uploaded logo, e.g. "Popular RKS" → "PR". */
function companyInitials(name) {
  return (
    (name || "")
      .split(/s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "C"
  );
}

/** Super admin: which company "Company View" pages are showing (picked in the top bar — CompanyPicker, lib/viewCompany.js). */
function ViewingCompany({ collapsed, tip }) {
  const [company, setCompany] = useState(null);
  useEffect(() => {
    setCompany(getViewCompany());
    const onChange = (e) => setCompany(e.detail);
    window.addEventListener(VIEW_COMPANY_EVENT, onChange);
    return () => window.removeEventListener(VIEW_COMPANY_EVENT, onChange);
  }, []);

  if (collapsed) return null;
  return (
    <div className="mx-1 mb-2 flex items-center gap-2 rounded-lg border sb-divider px-2.5 py-2 text-[12px]" {...tip(company?.name || "No company picked")}>
      <FiBriefcase size={13} className="shrink-0 sb-muted" />
      <span className="truncate sb-title font-semibold">{company?.name || "Pick a company in the top bar"}</span>
    </div>
  );
}

export default function Sidebar({ role, companyName, companyLogoUrl, followUpBadge, chatBadge, onLogout, open, onClose }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const asideRef = useRef(null);

  // Collapsed-rail tooltips are drawn once here, positioned against the
  // <aside>, rather than inside each item: the nav list scrolls (a long menu
  // must never push the footer off screen), and a scrolling box clips
  // anything inside it that pokes out sideways.
  const [tipState, setTipState] = useState(null);
  const tip = (label) =>
    collapsed
      ? {
          onMouseEnter: (e) => showTip(label, e.currentTarget),
          onFocus: (e) => showTip(label, e.currentTarget),
          onMouseLeave: () => setTipState(null),
          onBlur: () => setTipState(null),
        }
      : {};
  function showTip(label, el) {
    const aside = asideRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (aside) setTipState({ label, top: r.top - aside.top + r.height / 2 });
  }
  useEffect(() => setTipState(null), [collapsed]);
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
  const brandSubtitle = isSuperAdmin ? "Platform" : "Automobile CRM";

  const flatNavItems = navItemsFor(role);
  const isActive = (href) => router.pathname === href || (href !== "/" && router.pathname.startsWith(`${href}/`));

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        ref={asideRef}
        className={`sb fixed md:sticky top-0 left-0 z-50 flex flex-col h-screen h-[100dvh] shrink-0 transition-[transform,width] duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-[76px]" : "w-64 lg:w-72"}`}
      >
        <div className={`relative shrink-0 border-b sb-divider ${collapsed ? "px-3 py-4" : "px-5 py-5"}`}>
          <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "gap-3"}`}>
            {isSuperAdmin ? (
              <>
                {/* the bc mark alone — the full wordmark logo is unreadable at this size */}
                <span
                  className={`flex items-center justify-center shrink-0 rounded-[11px] bg-gradient-to-br from-[#232b48] to-[#0f1424] text-white ring-1 ring-white/10 shadow-[0_6px_16px_rgba(8,12,30,0.3)] ${collapsed ? "h-10 w-10" : "h-11 w-11"}`}
                  role="img"
                  aria-label={brandName}
                >
                  <BcMark className="w-[24px] h-auto" />
                </span>
                {!collapsed && (
                  <div className="min-w-0 leading-tight">
                    <div className="sb-title text-[15px] font-bold tracking-tight truncate">{brandName}</div>
                    <div className="sb-muted text-[11px] font-medium">{brandSubtitle}</div>
                  </div>
                )}
              </>
            ) : (
              // Company view: the company's own logo, on a white plate so a
              // dark or coloured logo reads on every theme. width/height are
              // left auto (only capped) so a wide landscape logo — most
              // company logos are — keeps its own aspect ratio. Without an
              // uploaded logo, a badge with the company's initials (rather
              // than any one brand's logo, which would be wrong for most
              // dealers).
              <div className="flex-1 min-w-0">
                {companyLogoUrl ? (
                  <div className={`sb-plate ${collapsed ? "!p-1.5 w-11 h-11 mx-auto" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={companyLogoUrl}
                      alt={brandName}
                      className={collapsed ? "h-auto w-auto max-h-8 max-w-[32px] object-contain" : "h-auto w-auto max-h-[52px] max-w-[190px] object-contain"}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-1">
                    <span
                      className={`flex items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-hover text-white font-bold tracking-wide shadow-[0_8px_20px_-6px_rgb(var(--accent-rgb)/0.6)] ${
                        collapsed ? "h-11 w-11 text-[14px]" : "h-14 w-14 text-[18px]"
                      }`}
                      role="img"
                      aria-label={brandName}
                    >
                      {companyInitials(companyName)}
                    </span>
                  </div>
                )}
                {!collapsed && (
                  <div className="mt-3 text-center leading-tight">
                    <div className="sb-title text-[13.5px] font-semibold truncate">{brandName}</div>
                    <div className="sb-muted text-[10.5px] font-semibold uppercase tracking-[0.16em] mt-0.5">{brandSubtitle}</div>
                  </div>
                )}
              </div>
            )}
            <button className="ml-auto md:hidden sb-muted bg-transparent border-none cursor-pointer" onClick={onClose} aria-label="Close menu">
              <CloseIcon />
            </button>
          </div>

          {isSuperAdmin && <RoleBadge label="Super Admin" collapsed={collapsed} />}

          <button type="button" onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="sb-toggle">
            {collapsed ? <ChevronRightIcon width={13} height={13} /> : <ChevronLeftIcon width={13} height={13} />}
          </button>
        </div>

        {/* The menu scrolls on its own when it's taller than the screen
            (the super admin's two groups are), so the footer below always
            stays pinned at the bottom. */}
        <nav className="sb-scroll flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-contain gap-1 px-3 py-4" onScroll={() => setTipState(null)}>
          {isSuperAdmin ? (
            SUPER_ADMIN_GROUPS.map(({ key, label }, i) => {
              const items = NAV_ITEMS.filter((item) => item.group === key && (item.superAdminOnly || item.superAdminVisible));
              if (items.length === 0) return null;
              return (
                <div key={key} className={i > 0 ? "mt-4" : ""}>
                  {!collapsed && <div className="sb-label">{label}</div>}
                  {key === "monitor" && <ViewingCompany collapsed={collapsed} tip={tip} />}
                  <div className="flex flex-col gap-1">
                    {items.map((item) => (
                      <NavItem key={item.href} {...item} active={isActive(item.href)} collapsed={collapsed} onClick={onClose} tip={tip} />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <>
              {!collapsed && <div className="sb-label">Menu</div>}
              {flatNavItems.map((item) => {
                // Due/overdue follow-ups need to be seen the moment an
                // agent opens the app, not just after they happen to click
                // into the Follow-ups page — matches the count already
                // reflected there.
                const badgeCount =
                  item.href === "/followups" && followUpBadge ? followUpBadge.overdue + followUpBadge.today : item.href === "/chats" && chatBadge ? chatBadge.conversations : 0;
                const badgeUrgent = (item.href === "/followups" && followUpBadge?.overdue > 0) || (item.href === "/chats" && chatBadge?.conversations > 0);
                return (
                  <NavItem
                    key={item.href}
                    {...item}
                    active={isActive(item.href)}
                    collapsed={collapsed}
                    badgeCount={badgeCount}
                    badgeUrgent={badgeUrgent}
                    onClick={onClose}
                    tip={tip}
                  />
                );
              })}
            </>
          )}
        </nav>

        <div className={`shrink-0 border-t sb-divider flex flex-col gap-1.5 ${collapsed ? "px-3 py-3" : "px-4 py-3"}`}>
          {/* Username/role and the theme picker live in the TopBar's
              profile dropdown (components/ProfileMenu.js), so the footer
              stays short and the menu keeps the room. */}

          <button className={`sb-logout ${collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 h-10"}`} onClick={onLogout} {...tip("Logout")}>
            <LogoutIcon />
            {!collapsed && <span>Logout</span>}
          </button>

          {!collapsed && (
            <div className="flex items-center justify-center gap-1.5 pt-1 sb-muted text-[10.5px]">
              Developed by
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/broaddcast-logo.svg" alt="BroaddCast Business Solutions" className="sb-dev-logo h-[18px] w-auto opacity-80" />
            </div>
          )}
        </div>
        {tipState && (
          <span className="sb-tip !opacity-100" style={{ top: tipState.top }} role="tooltip">
            {tipState.label}
          </span>
        )}
      </aside>
    </>
  );
}
