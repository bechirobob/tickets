"use client";

import PaymentFooter from "./payment-footer";
import BrandLogo from "./brand-logo";
import Link from "next/link";
import { Bell, MapPin, Ticket } from "lucide-react";
import ActiveNightExperience from "./active-night-experience";
import type { CustomerEvent } from "../lib/customer-screen";
import ScrollReveal from "./scroll-reveal";
import PublicNavigation from "./mobile-navigation";

export default function HomeScreen({ events }: { events: CustomerEvent[] }) {
  return <main className="night-home compact-home discovery-home" id="main-content">
    <a className="discovery-skip" href="#drop">Skip to events</a>
    <ScrollReveal />
    <header className="night-header">
      <Link href="/" className="night-brand-link"><BrandLogo prominent /></Link>
      <div className="night-header__actions"><nav className="night-desktop-links" aria-label="Explore"><Link href="/events">The Drop</Link><Link href="/hosts">Hosts</Link><Link href="/my-nights">My Nights</Link></nav><span className="night-city"><MapPin size={14} aria-hidden="true" /> Accra, GH</span><PublicNavigation primaryVisible /></div>
    </header>

    <ActiveNightExperience events={events} />

    <section className="box-office-guest-kit" aria-labelledby="guest-kit-title">
      <p className="night-kicker">BeCore Tickets</p><h2 id="guest-kit-title">Good to go.</h2>
      <dl>
        <div><dt><Ticket aria-hidden="true" size={20} /> Your tickets</dt><dd>Keep your bookings and entry passes in My Nights.</dd></div>
        <div><dt><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V9a7 7 0 0 1 14 0v12M3 21h18M5 9l9-3v15H5M10.5 14h.01" /></svg> The Room</dt><dd>Meet the crowd before your night begins.</dd></div>
        <div><dt><Bell aria-hidden="true" size={20} /> Host updates</dt><dd>Check My Nights for updates to your plans.</dd></div>
      </dl>
    </section>

    <footer className="night-footer compact-footer">
      <PaymentFooter />
      <BrandLogo prominent />
      <p>Accra, we’re going out. Tell the group chat.</p>
      <div><Link href="/staff">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
    </footer>
  </main>;
}
