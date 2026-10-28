"use client";

import Link from "next/link";
import { CalendarDays, House, Ticket, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from "next/navigation";
import { restorePublicDestination } from "./public-browsing-memory";
import { useRoomUpdates } from './use-room-updates';
import { useHeaderPanel } from './use-header-panel';
import { useTopPanelPosition } from './use-top-panel-position';
import './room-shortcut.css';

const hiddenPrefixes = ["/the-yorke-way", "/admin", "/staff", "/checkout", "/organizer", "/payment", "/room", "/scan", "/rsvp/"];
const dockMediaQuery = '(max-width: 700px)';
const dockIsVisible = () => window.matchMedia(dockMediaQuery).matches;
const serverDockIsVisible = () => false;
const subscribeToDockViewport = (changed: () => void) => {
  const media = window.matchMedia(dockMediaQuery);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};

export default function CustomerDock() {
  const pathname = usePathname();
  const hidden = hiddenPrefixes.some((prefix) => pathname.startsWith(prefix));
  const dockVisible = useSyncExternalStore(subscribeToDockViewport, dockIsVisible, serverDockIsVisible);
  const { rooms, refresh } = useRoomUpdates(!hidden && dockVisible, pathname);
  const { id, trigger, panel, ready, open, mounted, phase, toggle, close } = useHeaderPanel();
  const position = useTopPanelPosition(mounted, trigger, () => close(true, true));
  useEffect(() => {
    if (!rooms.length || hidden) {
      const timer = window.setTimeout(() => close(false, true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [close, hidden, rooms.length]);
  if (hidden) return null;
  const unread = rooms.reduce((total, room) => total + room.unread, 0);
  const badge = unread ? <b className="customer-room-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</b> : null;
  const roomLabel = <><span className="customer-room-symbol"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V9a7 7 0 0 1 14 0v12M3 21h18" /><path d="M5 9l9-3v15H5" /><path d="M10.5 14h.01" /></svg>{badge}</span><span>Room</span></>;
  const roomDescription = unread ? `Room, ${unread} new updates` : 'Room';

  const items = [
    { href: "/", label: "Home", icon: House, active: pathname === "/" },
    { href: "/events", label: "The Drop", icon: CalendarDays, active: pathname === "/events" || pathname.startsWith("/event/") },
    { href: "/my-nights", label: "My Nights", icon: Ticket, active: pathname.startsWith("/my-nights") || pathname.startsWith("/tickets") || pathname.startsWith("/account/") || pathname.startsWith("/notifications") },
  ];

  return <><nav className={`customer-dock${rooms.length ? ' customer-dock--with-room' : ''}`} aria-label="Customer navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} scroll={false} aria-current={item.active ? "page" : undefined} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (pathname !== item.href) { restorePublicDestination(item.href); return; }
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        }}>
          <Icon size={17} />
          <span>{item.label}</span>
        </Link>;
      })}
      {rooms.length === 1 ? <Link className="customer-room-link" prefetch={false} href={`/room/${encodeURIComponent(rooms[0].eventSlug)}`} aria-label={roomDescription}>{roomLabel}</Link>
        : rooms.length > 1 ? <button ref={trigger} type="button" className="customer-room-link" aria-label={roomDescription} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} disabled={!ready} onClick={event => { toggle(event.detail === 0); void refresh(); }}>{roomLabel}</button> : null}
    </nav>
    {mounted && rooms.length > 0 && createPortal(<section ref={panel} id={id} role="dialog" aria-modal="false" aria-label="Choose your Room" inert={!open} data-phase={phase} className="notification-panel notification-panel--dropdown customer-room-chooser" style={position}>
      <header className="notification-panel-header"><div><h2>Your Rooms</h2></div><button type="button" aria-label="Close Rooms" onClick={() => close(true)}><X size={19} aria-hidden="true" /></button></header>
      <ul className="notification-panel-scroll">{rooms.map(room => <li key={room.eventSlug}><Link prefetch={false} href={`/room/${encodeURIComponent(room.eventSlug)}`} onClick={() => close()} aria-label={`${room.title}${room.unread ? `, ${room.unread} new updates` : ', no new updates'}`}><span>{room.title}</span>{room.unread > 0 && <b aria-hidden="true">{room.unread > 99 ? '99+' : room.unread}</b>}</Link></li>)}</ul>
    </section>, document.body)}
    </>;
}
