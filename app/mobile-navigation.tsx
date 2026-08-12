"use client";

import { CalendarDays, CalendarPlus, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const links = [
  { href: "/events", label: "The Drop", icon: CalendarDays },
  { href: "/my-nights", label: "My Nights", icon: Ticket },
  { href: "/hosts", label: "Hosts", icon: UsersRound },
  { href: "/organizer/submit", label: "Organisers", icon: CalendarPlus },
  { href: "/about", label: "About us", icon: Info },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

export default function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const navigation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        navigation.current?.querySelector<HTMLButtonElement>("button")?.focus();
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
      type="button"
      className="night-mobile-menu__trigger"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={open ? "Close navigation" : "Open navigation"}
      onClick={() => setOpen((current) => !current)}
    >
      {open ? <X size={20} /> : <Menu size={20} />}
    </button>
    {open ? <nav id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation">
      {links.map((link) => {
        const Icon = link.icon;
        const active = pathname === link.href || (link.href !== "/events" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/"));
        return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={17} aria-hidden="true" /><span>{link.label}</span></Link>;
      })}
    </nav> : null}
  </div>;
}
