"use client";

import { CalendarDays, CalendarPlus, ChevronRight, House, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useHeaderPanel } from "./use-header-panel";
import { useTopPanelPosition } from "./use-top-panel-position";

const links = [
  { href: "/", label: "Home", icon: House },
  { href: "/events", label: "The Drop", icon: CalendarDays },
  { href: "/hosts", label: "Discover hosts", icon: UsersRound },
  { href: "/my-nights", label: "My Nights", icon: Ticket },
  { href: "/organizer/submit", label: "List your event", icon: CalendarPlus },
  { href: "/about", label: "About us", icon: Info },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

const mobileQuery = "(max-width: 760px)";
const subscribeToMobile = (change: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const isMobile = () => window.matchMedia(mobileQuery).matches;
const serverIsMobile = () => false;

export default function MobileNavigation({ primaryVisible = false }: { primaryVisible?: boolean }) {
  const { open, mounted, phase, ready, trigger, panel, id: panelId, toggle, close } = useHeaderPanel();
  const position = useTopPanelPosition(mounted, trigger, () => close(true, true));
  const pathname = usePathname();

  const mobile = useSyncExternalStore(subscribeToMobile, isMobile, serverIsMobile);
  const previousMobile = useRef(mobile);
  useEffect(() => {
    if (previousMobile.current === mobile) return;
    previousMobile.current = mobile;
    // Mobile owns a Back boundary; desktop does not. End the disclosure
    // so its history entry and focus cannot cross those interaction modes.
    if (open) close(true);
  }, [close, mobile, open]);
  const menuClass = `night-mobile-menu${open ? " is-open" : ""}${primaryVisible ? " has-primary-nav" : ""}`;

  const navigation = <nav ref={panel} inert={!open} data-phase={phase} id={panelId} className="night-mobile-menu__panel" style={position} aria-label="Main navigation" aria-hidden={!open}>
      <header className="night-mobile-menu__panel-header">
        <span>Menu</span>
        <button type="button" className="night-mobile-menu__close" aria-label="Close navigation" tabIndex={open ? undefined : -1} onClick={() => {
          close(true);
        }}><X size={18} strokeWidth={1.65} aria-hidden="true" /></button>
      </header>
      <div className="night-mobile-menu__links">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/")) || (link.href === "/my-nights" && ["/tickets", "/account/", "/notifications"].some((prefix) => pathname.startsWith(prefix)));
          const routeClass = ["/", "/events", "/my-nights"].includes(link.href) ? "menu-primary-route" : link.href === "/hosts" ? "menu-host-route" : "";
          const classes = [routeClass, ["/about", "/help"].includes(link.href) ? "menu-secondary-route" : "", link.href === "/about" ? "menu-section-start" : ""].filter(Boolean).join(" ");
          return <Link className={classes} key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={() => close()}>
            <Icon size={19} strokeWidth={1.65} aria-hidden="true" />
            <span>{link.label}</span>
            <ChevronRight className="night-mobile-menu__chevron" size={15} strokeWidth={1.65} aria-hidden="true" />
          </Link>;
        })}
      </div>
    </nav>;

  return <div className={menuClass}>
    <button
      ref={trigger}
      type="button"
      className="night-mobile-menu__trigger"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={open ? "Close navigation" : "Open navigation"}
      disabled={!ready}
      aria-busy={!ready}
      onClick={(event) => {
        toggle(event.detail === 0 || mobile);
      }}
    >
      <Menu size={20} aria-hidden="true" /><span className="night-mobile-menu__trigger-label">Menu</span>
    </button>
    {ready ? createPortal(<div className={`${menuClass} night-mobile-menu--overlay`} data-phase={phase}>
      {mobile ? <div className="night-mobile-menu__scrim" aria-hidden="true" onPointerDown={(event) => { event.preventDefault(); close(true); }} /> : null}
      {navigation}
    </div>, document.body) : navigation}
  </div>;
}
