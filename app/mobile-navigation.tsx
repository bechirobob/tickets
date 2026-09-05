"use client";

import { CalendarDays, CalendarPlus, House, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const links = [
  { href: "/", label: "Home", icon: House },
  { href: "/events", label: "The Drop", icon: CalendarDays },
  { href: "/hosts", label: "Hosts", icon: UsersRound },
  { href: "/my-nights", label: "My Nights", icon: Ticket },
  { href: "/organizer/submit", label: "Organisers", icon: CalendarPlus },
  { href: "/about", label: "About us", icon: Info },
  { href: "/help", label: "Help", icon: LifeBuoy },
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
      <Menu size={20} />
    </button>
    <nav id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation" aria-hidden={!open}>
      <header className="night-mobile-menu__panel-header">
        <span>Menu</span>
        <button type="button" className="night-mobile-menu__close" aria-label="Close navigation" tabIndex={open ? undefined : -1} onClick={() => {
          setOpen(false);
          trigger.current?.focus();
        }}><X size={19} /></button>
      </header>
      <div className="night-mobile-menu__links">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/")) || (link.href === "/my-nights" && ["/tickets", "/account/", "/notifications"].some((prefix) => pathname.startsWith(prefix)));
          return <Link key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={16} aria-hidden="true" /><span>{link.label}</span></Link>;
        })}
      </div>
    </nav>
  </div>;
}
