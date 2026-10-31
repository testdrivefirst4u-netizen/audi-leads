import Link from "next/link";
import { useRouter } from "next/router";
import { navItemsFor } from "./Sidebar";
import { MenuIcon } from "./icons";

// Phones only: the pages a salesperson on the showroom floor uses most, one
// tap away at the bottom of the screen; "More" opens the full sidebar drawer.
const TAB_HREFS = {
  default: ["/", "/leads", "/followups", "/chats"],
  super_admin: ["/companies", "/", "/leads", "/reports"],
};

export default function MobileTabBar({ role, followUpBadge, chatBadge, onMore }) {
  const router = useRouter();
  const wanted = TAB_HREFS[role === "super_admin" ? "super_admin" : "default"];
  const items = navItemsFor(role)
    .filter((item) => wanted.includes(item.href))
    .sort((a, b) => wanted.indexOf(a.href) - wanted.indexOf(b.href));
  const isActive = (href) => router.pathname === href || (href !== "/" && router.pathname.startsWith(`${href}/`));

  const badgeFor = (href) => {
    if (href === "/followups" && followUpBadge) return { count: followUpBadge.overdue + followUpBadge.today, urgent: followUpBadge.overdue > 0 };
    if (href === "/chats" && chatBadge) return { count: chatBadge.conversations, urgent: chatBadge.conversations > 0 };
    return null;
  };

  const tabCls = (active) =>
    `relative flex flex-1 flex-col items-center justify-center gap-1 h-14 text-[10.5px] font-semibold no-underline bg-transparent border-none cursor-pointer ${
      active ? "text-accent" : "text-muted"
    }`;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-border bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
    >
      {items.map(({ href, label, Icon }) => {
        const active = isActive(href);
        const badge = badgeFor(href);
        return (
          <Link key={href} href={href} className={tabCls(active)} aria-current={active ? "page" : undefined}>
            {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" aria-hidden="true" />}
            <span className="relative">
              <Icon width={20} height={20} />
              {badge?.count > 0 && (
                <span
                  className={`absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[9.5px] font-bold flex items-center justify-center ${
                    badge.urgent ? "bg-danger" : "bg-muted"
                  }`}
                >
                  {badge.count > 9 ? "9+" : badge.count}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
      <button type="button" className={tabCls(false)} onClick={onMore}>
        <MenuIcon width={20} height={20} />
        More
      </button>
    </nav>
  );
}
