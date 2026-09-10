"use client";

import { CalendarDays, CalendarPlus, House, Info, LifeBuoy, Menu, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHeaderPanel } from "./use-header-panel";

const links = [
  { href: "/", label: "Home", icon: House },
  { href: "/events", label: "The Drop", icon: CalendarDays },
  { href: "/hosts", label: "Hosts", icon: UsersRound },
  { href: "/my-nights", label: "My Nights", icon: Ticket },
  { href: "/organizer/submit", label: "Organisers", icon: CalendarPlus },
  { href: "/about", label: "About us", icon: Info },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

export default function MobileNavigation({ primaryVisible = false }: { primaryVisible?: boolean }) {
  const { open, phase, ready, trigger, panel, id: panelId, toggle, close } = useHeaderPanel();
  const pathname = usePathname();

  return <div className={`night-mobile-menu${open ? " is-open" : ""}${primaryVisible ? " has-primary-nav" : ""}`}>
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
        toggle(event.detail === 0);
      }}
    >
      <Menu size={20} />
    </button>
    <nav ref={panel} inert={!open} data-phase={phase} id={panelId} className="night-mobile-menu__panel" aria-label="Main navigation" aria-hidden={!open}>
      <header className="night-mobile-menu__panel-header">
        <span>Menu</span>
        <button type="button" className="night-mobile-menu__close" aria-label="Close navigation" tabIndex={open ? undefined : -1} onClick={() => {
          close(true);
        }}><X size={19} /></button>
      </header>
      <div className="night-mobile-menu__links">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) || (link.href === "/events" && pathname.startsWith("/event/")) || (link.href === "/my-nights" && ["/tickets", "/account/", "/notifications"].some((prefix) => pathname.startsWith(prefix)));
          return <Link className={["/", "/events", "/my-nights"].includes(link.href) ? "menu-primary-route" : link.href === "/hosts" ? "menu-host-route" : undefined} key={link.href} href={link.href} tabIndex={open ? undefined : -1} aria-current={active ? "page" : undefined} onClick={() => close()}><Icon size={16} aria-hidden="true" /><span>{link.label}</span></Link>;
        })}
      </div>
    </nav>
  </div>;
}
