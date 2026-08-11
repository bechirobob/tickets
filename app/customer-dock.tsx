"use client";

import Link from "next/link";
import { CalendarDays, House, Ticket } from "lucide-react";
import { usePathname } from "next/navigation";

const hiddenPrefixes = ["/admin", "/checkout", "/organizer", "/payment", "/room", "/scan"];

export default function CustomerDock() {
  const pathname = usePathname();
  if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;

  const items = [
    { href: "/", label: "Home", icon: House, active: pathname === "/" },
    { href: "/events", label: "The Drop", icon: CalendarDays, active: pathname === "/events" || pathname.startsWith("/event/") },
    { href: "/my-nights", label: "My Nights", icon: Ticket, active: pathname.startsWith("/my-nights") || pathname.startsWith("/tickets") || pathname.startsWith("/account/") },
  ];

  return <nav className="customer-dock" aria-label="Customer navigation">
    {items.map((item) => {
      const Icon = item.icon;
      return <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>
        <Icon size={17} />
        <span>{item.label}</span>
      </Link>;
    })}
  </nav>;
}
