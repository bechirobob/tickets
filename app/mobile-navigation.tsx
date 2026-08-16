"use client";

import { CalendarDays, CalendarPlus, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const groups = [
  { label: "Discover", links: [
    { href: "/events", label: "The Drop", icon: CalendarDays },
    { href: "/hosts", label: "Hosts", icon: UsersRound },
  ] },
  { label: "Your nights", links: [
    { href: "/my-nights", label: "My Nights", icon: Ticket },
  ] },
  { label: "Work with us", links: [
    { href: "/organizer/submit", label: "Organisers", icon: CalendarPlus },
  ] },
  { label: "BeCore", links: [
    { href: "/about", label: "About us", icon: Info },
    { href: "/help", label: "Help", icon: LifeBuoy },
  ] },
];

export default function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const navigation = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(pathname);
  const focusFirstLink = useRef(false);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open || !focusFirstLink.current) return;
    focusFirstLink.current = false;
    navigation.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
      if (event instanceof PointerEvent && !navigation.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return <div ref={navigation} className={`night-mobile-menu${open ? " is-open" : ""}`}>
    <button
      ref={trigger}
      type="button"
      className="night-mobile-menu__trigger"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={open ? "Close navigation" : "Open navigation"}
      onClick={(event) => {
        if (!open && event.detail === 0) focusFirstLink.current = true;
        setOpen((current) => !current);
      }}
    >
      {open ? <X size={20} /> : <Menu size={20} />}
    </button>
    <nav id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation" aria-hidden={!open}>
      {groups.map((group) => <section key={group.label} className="night-mobile-menu__group" aria-labelledby={`${panelId}-${group.label.replaceAll(" ", "-").toLowerCase()}`}>
        <span id={`${panelId}-${group.label.replaceAll(" ", "-").toLowerCase()}`} className="night-mobile-menu__label">{group.label}</span>
        {group.links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/events" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/"));
          return <Link key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={17} aria-hidden="true" /><span>{link.label}</span></Link>;
        })}
      </section>)}
    </nav>
  </div>;
}
