"use client";

import PaymentFooter from "./payment-footer";
import BrandLogo from "./brand-logo";
import Image from "next/image";
import Link from "next/link";
import { Bell, MapPin, MessageCircle, Ticket } from "lucide-react";
import { ActionLink } from "./action";
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

    <section className="organizer-intelligence backstage-bridge backstage-bridge--split" data-scroll-reveal>
      <div className="organizer-intelligence__copy">
        <p className="night-kicker"><span /> Behind the night / Meet the Hosts</p>
        <h2>Find your people.<br />Make a night of it.</h2>
        <p>Meet the people behind the nights and find your next plan.</p>
        <div className="backstage-bridge__actions"><ActionLink href="/hosts">Meet the Hosts</ActionLink><ActionLink href="/events" variant="text">Explore nights</ActionLink></div>
      </div>
      <figure className="backstage-bridge__image"><Image src="/atmospheres/behind-the-night.webp" width={1100} height={733} sizes="(max-width: 700px) 100vw, 50vw" alt="" aria-hidden="true" unoptimized /><figcaption>Good nights don’t happen by accident.</figcaption></figure>
      <dl>
        <div><dt><Ticket aria-hidden="true" size={20} /> Your tickets</dt><dd>Keep your bookings and entry passes in My Nights.</dd></div>
        <div><dt><MessageCircle aria-hidden="true" size={20} /> The Room</dt><dd>Meet the crowd before your night begins.</dd></div>
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
