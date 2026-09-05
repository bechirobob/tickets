"use client";

import Link from "next/link";
import { Bell, ShieldCheck, Ticket } from "lucide-react";
import { usePathname } from "next/navigation";

export default function AccountNavigation() {
  const pathname = usePathname();
  const section = pathname.startsWith("/notifications") ? "buzz" : pathname.startsWith("/account/privacy") ? "privacy" : "nights";
  return <nav className="account-navigation" aria-label="Your account">
    <Link href="/my-nights" aria-current={section === "nights" ? "page" : undefined}><Ticket size={16} aria-hidden="true" />My Nights</Link>
    <Link href="/notifications" aria-current={section === "buzz" ? "page" : undefined}><Bell size={16} aria-hidden="true" />The Buzz</Link>
    <Link href="/account/privacy" aria-current={section === "privacy" ? "page" : undefined}><ShieldCheck size={16} aria-hidden="true" />Privacy</Link>
  </nav>;
}
