"use client";

import Link from "next/link";
import { Bell, CalendarDays, House, Ticket } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const hiddenPrefixes = ["/admin", "/checkout", "/organizer", "/payment", "/room", "/scan"];

export default function CustomerDock() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return;
    void fetch("/api/customer/notifications", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<{ unread?: number }> : null).then((result) => setUnread(result?.unread ?? 0));
  }, [pathname]);
  if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;

  const items = [
    { href: "/", label: "Home", icon: House, active: pathname === "/" },
    { href: "/events", label: "The Drop", icon: CalendarDays, active: pathname === "/events" || pathname.startsWith("/event/") },
    { href: "/my-nights", label: "My Nights", icon: Ticket, active: pathname.startsWith("/my-nights") || pathname.startsWith("/tickets") || pathname.startsWith("/account/") },
    { href: "/notifications", label: unread ? `Buzz ${unread > 9 ? "9+" : unread}` : "The Buzz", icon: Bell, active: pathname.startsWith("/notifications") },
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
