"use client";

import { CalendarDays, CalendarPlus, ChevronRight, House, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useHeaderPanel } from "./use-header-panel";

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
  const { open, phase, ready, trigger, panel, id: panelId, toggle, close } = useHeaderPanel(160);
  const pathname = usePathname();
  // Keep the disclosure tied to the real button, including safe-area layouts,
  // zoom, scrolling headers and resized visual viewports. Never infer its top
  // from a generic header height (that creates a detached dropdown).
  useLayoutEffect(() => {
    if (phase === "closed") return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const menu = panel.current;
      if (!anchor || !menu) return;
      const viewport = window.visualViewport;
      if (document.visibilityState === "hidden" || (viewport && (viewport.width <= 0 || viewport.height <= 0))) return;
      if (window.innerWidth <= 0 || window.innerHeight <= 0) return;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const availableWidth = Math.min(194, anchor.right - left - 12);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const dock = document.querySelector<HTMLElement>(".customer-dock")?.getBoundingClientRect();
      const limit = dock && dock.height && dock.top > anchor.bottom ? Math.min(bottom - 8, dock.top - 8) : bottom - 8;
      // Fractional scroll rounding can clip less than one CSS pixel of an
      // otherwise usable trigger. Keep its panel inside the visible viewport.
      const anchorTop = Math.max(top, anchor.top);
      if (anchor.top < top - 1 || anchor.right > left + (viewport?.width ?? window.innerWidth) || availableWidth < anchor.width || limit - anchorTop < anchor.height + 44) { close(true, true); return; }
      menu.style.setProperty("--menu-width", `${availableWidth}px`);
      menu.style.setProperty("--menu-anchor-top", `${anchorTop}px`);
      menu.style.setProperty("--menu-anchor-right", `${window.innerWidth - anchor.right}px`);
      menu.style.setProperty("--menu-anchor-width", `${anchor.width}px`);
      menu.style.setProperty("--menu-anchor-height", `${anchor.height}px`);
      menu.style.setProperty("--menu-max-height", `${limit - anchorTop}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("pageshow", place);
    document.addEventListener("visibilitychange", place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("pageshow", place);
      document.removeEventListener("visibilitychange", place);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [close, panel, phase, trigger]);

  const mobile = useSyncExternalStore(subscribeToMobile, isMobile, serverIsMobile);
  const previousMobile = useRef(mobile);
  const swipe = useRef<{ pointer: number; x: number; y: number; time: number; distance: number } | null>(null);
  useEffect(() => {
    if (previousMobile.current === mobile) return;
    previousMobile.current = mobile;
    // End the owned mobile history entry when crossing layouts.
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
    if (!mobile || !open || !event.isPrimary || event.button !== 0) return;
    swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, distance: 0 };
  };
  const moveSwipe = (event: PointerEvent<HTMLElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - gesture.y);
    if (Math.abs(event.clientX - gesture.x) > Math.max(16, distance)) { resetSwipe(); return; }
    if (distance < 6) return;
    // Capture only after a real drag, preserving ordinary close-button taps
    // even when the narrow cap is exactly one 44px target wide.
    event.currentTarget.setPointerCapture(event.pointerId);
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

  const navigation = <nav ref={panel} inert={phase === "closed"} data-phase={phase} id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation" aria-hidden={!open}>
      <header className="night-mobile-menu__panel-header" onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={finishSwipe} onPointerCancel={resetSwipe} onLostPointerCapture={resetSwipe}>
        <button type="button" className="night-mobile-menu__close" aria-label="Close navigation" disabled={!open} tabIndex={open ? undefined : -1} onClick={() => {
          close(true);
        }}><X size={18} strokeWidth={1.65} aria-hidden="true" /></button>
      </header>
      <div className="night-mobile-menu__links">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/")) || (link.href === "/my-nights" && ["/tickets", "/account/", "/notifications"].some((prefix) => pathname.startsWith(prefix)));
          const routeClass = ["/", "/events", "/my-nights"].includes(link.href) ? "menu-primary-route" : link.href === "/hosts" ? "menu-host-route" : "";
          const classes = [routeClass, ["/about", "/help"].includes(link.href) ? "menu-secondary-route" : "", link.href === "/about" ? "menu-section-start" : ""].filter(Boolean).join(" ");
          return <Link className={classes} key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={(event) => { if (!open) event.preventDefault(); else close(); }}>
            <Icon size={19} strokeWidth={1.65} aria-hidden="true" />
            <span>{link.label}</span>
            <ChevronRight className="night-mobile-menu__chevron" size={15} strokeWidth={1.65} aria-hidden="true" />
          </Link>;
        })}
      </div>
    </nav>;

  return <div className={menuClass} data-phase={phase}>
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
    {ready && typeof document !== "undefined" ? createPortal(
      <div className={`${menuClass} night-mobile-menu--anchored`} data-phase={phase}>{navigation}</div>, document.body,
    ) : navigation}
  </div>;
}
