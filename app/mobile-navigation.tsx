"use client";

import { Menu, Ticket, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const links = [
  { href: "/events", label: "The Drop" },
  { href: "/organizer/submit", label: "Organisers" },
  { href: "#about", label: "About us" },
  { href: "/help", label: "Help" },
];

export default function MobileNavigation() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <div className={`night-mobile-menu${open ? " is-open" : ""}`}>
    <button
      type="button"
      className="night-mobile-menu__trigger"
      aria-expanded={open}
      aria-controls="mobile-main-navigation"
      aria-label={open ? "Close navigation" : "Open navigation"}
      onClick={() => setOpen((current) => !current)}
    >
      {open ? <X size={20} /> : <Menu size={20} />}
    </button>
    {open ? <nav id="mobile-main-navigation" className="night-mobile-menu__panel" aria-label="Mobile navigation">
      {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
      <Link href="/my-nights" className="night-mobile-menu__wallet" onClick={() => setOpen(false)}><Ticket size={17} /> My Nights</Link>
    </nav> : null}
  </div>;
}
