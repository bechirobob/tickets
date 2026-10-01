"use client";

import { CalendarDays, CalendarPlus, House, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useHeaderPanel } from "./use-header-panel";

const links = [
  { href: "/", label: "Home", icon: House },
  { href: "/events", label: "The Drop", icon: CalendarDays },
  { href: "/hosts", label: "Hosts", icon: UsersRound },
  { href: "/my-nights", label: "My Nights", icon: Ticket },
  { href: "/organizer/submit", label: "Organisers", icon: CalendarPlus },
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
  const { open, phase, ready, trigger, panel, id: panelId, toggle, close } = useHeaderPanel();
  const pathname = usePathname();

  const mobile = useSyncExternalStore(subscribeToMobile, isMobile, serverIsMobile);
  const previousMobile = useRef(mobile);
  const swipe = useRef<{ pointer: number; x: number; y: number; time: number; distance: number } | null>(null);
  useEffect(() => {
    if (previousMobile.current === mobile) return;
    previousMobile.current = mobile;
    // The portal changes its DOM anchor at this breakpoint. End the current
    // disclosure so its owned history entry and focus cannot cross layouts.
    swipe.current = null;
    panel.current?.style.removeProperty("--menu-drag-y");
    panel.current?.removeAttribute("data-dragging");
    if (open) close(true);
  }, [close, mobile, open, panel]);
  const resetSwipe = () => {
    swipe.current = null;
    panel.current?.style.removeProperty("--menu-drag-y");
    panel.current?.removeAttribute("data-dragging");
  };
  const startSwipe = (event: PointerEvent<HTMLElement>) => {
    if (!mobile || !open || !event.isPrimary || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, distance: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveSwipe = (event: PointerEvent<HTMLElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - gesture.y);
    if (Math.abs(event.clientX - gesture.x) > Math.max(16, distance)) { resetSwipe(); return; }
    gesture.distance = Math.min(distance, 220);
    panel.current?.setAttribute("data-dragging", "true");
    panel.current?.style.setProperty("--menu-drag-y", `${gesture.distance}px`);
  };
  const finishSwipe = (event: PointerEvent<HTMLElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const velocity = gesture.distance / Math.max(1, event.timeStamp - gesture.time);
    const dismiss = gesture.distance >= 56 || (gesture.distance > 18 && velocity > .55);
    resetSwipe();
    if (dismiss) close(true);
  };
  const menuClass = `night-mobile-menu${open ? " is-open" : ""}${primaryVisible ? " has-primary-nav" : ""}`;

  const navigation = <nav ref={panel} inert={!open} data-phase={phase} id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation" aria-hidden={!open}>
      <header className="night-mobile-menu__panel-header" onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={finishSwipe} onPointerCancel={resetSwipe} onLostPointerCapture={resetSwipe}>
        {mobile ? <span className="night-mobile-menu__handle" aria-hidden="true" /> : null}
        <span>Menu</span>
        <button type="button" className="night-mobile-menu__close" aria-label="Close navigation" tabIndex={open ? undefined : -1} onClick={() => {
          close(true);
        }}><X size={19} /></button>
      </header>
      <div className="night-mobile-menu__links">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/")) || (link.href === "/my-nights" && ["/tickets", "/account/", "/notifications"].some((prefix) => pathname.startsWith(prefix)));
          return <Link className={["/", "/events", "/my-nights"].includes(link.href) ? "menu-primary-route" : link.href === "/hosts" ? "menu-host-route" : undefined} key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={() => close()}><Icon size={16} aria-hidden="true" /><span>{link.label}</span></Link>;
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
    {mobile ? createPortal(<div className={`${menuClass} night-mobile-menu--sheet`} data-phase={phase}>
      <div className="night-mobile-menu__scrim" aria-hidden="true" onPointerDown={() => close(true)} />
      {navigation}
    </div>, document.body) : navigation}
  </div>;
}
