"use client";

import BoxOfficeFooter from "./box-office-footer";
import { Bell, Ticket } from "lucide-react";
import ActiveNightExperience from "./active-night-experience";
import type { CustomerEvent } from "../lib/customer-screen";
import ScrollReveal from "./scroll-reveal";
import BoxOfficeHeader from "./box-office-header";

export default function HomeScreen({ events }: { events: CustomerEvent[] }) {
  return <main className="night-home compact-home discovery-home" id="main-content">
    <a className="discovery-skip" href="#drop">Skip to events</a>
    <ScrollReveal />
    <BoxOfficeHeader />

    <ActiveNightExperience events={events} />

    <section className="box-office-guest-kit" aria-labelledby="guest-kit-title">
      <p className="night-kicker">BeCore Tickets</p><h2 id="guest-kit-title">Good to go.</h2>
      <dl>
        <div><dt><Ticket aria-hidden="true" size={20} /> Your tickets</dt><dd>Keep your bookings and entry passes in My Nights.</dd></div>
        <div><dt><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V9a7 7 0 0 1 14 0v12M3 21h18M5 9l9-3v15H5M10.5 14h.01" /></svg> The Room</dt><dd>Meet the crowd before your night begins.</dd></div>
        <div><dt><Bell aria-hidden="true" size={20} /> Host updates</dt><dd>Check My Nights for updates to your plans.</dd></div>
      </dl>
    </section>

    <BoxOfficeFooter />
  </main>;
}
