"use client";

import Link from "next/link";
import { CalendarDays, House, Ticket } from "lucide-react";
import { usePathname } from "next/navigation";
import { restorePublicDestination } from "./public-browsing-memory";

const hiddenPrefixes = ["/admin", "/checkout", "/organizer", "/payment", "/room", "/scan", "/rsvp/"];

export default function CustomerDock() {
  const pathname = usePathname();
  if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;

  const items = [
    { href: "/", label: "Home", icon: House, active: pathname === "/" },
    { href: "/events", label: "The Drop", icon: CalendarDays, active: pathname === "/events" || pathname.startsWith("/event/") },
    { href: "/my-nights", label: "My Nights", icon: Ticket, active: pathname.startsWith("/my-nights") || pathname.startsWith("/tickets") || pathname.startsWith("/account/") || pathname.startsWith("/notifications") },
  ];

  return <nav className="customer-dock" aria-label="Customer navigation">
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
    </nav>;
}
