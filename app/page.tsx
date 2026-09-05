import Link from "next/link";
import { MapPin } from "lucide-react";
import { ActionLink } from "./action";
import ActiveNightExperience from "./active-night-experience";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";
import PublicNavigation from "./mobile-navigation";

function BrandMark() {
  return <span className="night-brand" aria-label="BeCore Tickets"><b>B</b><span>BeCore<br />Tickets</span></span>;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await getPublicEvents();

  return <main className="night-home compact-home discovery-home" id="main-content">
    <a className="discovery-skip" href="#drop">Skip to events</a>
    <ScrollReveal />
    <header className="night-header">
      <Link href="/" className="night-brand-link"><BrandMark /></Link>
      <div className="night-header__actions"><nav className="night-desktop-links" aria-label="Explore"><Link href="/events">The Drop</Link><Link href="/hosts">Hosts</Link><Link href="/my-nights">My Nights</Link></nav><span className="night-city"><MapPin size={14} aria-hidden="true" /> Accra, GH</span><PublicNavigation /></div>
    </header>

    <ActiveNightExperience events={events} />

    <section className="organizer-intelligence" data-scroll-reveal>
      <div className="organizer-intelligence__copy">
        <p className="night-kicker"><span /> For organisers</p>
        <h2>Your crowd.<br />Your next great night.</h2>
        <p>Ticket sales, guest updates and a smoother door. One place to run your event and understand what worked.</p>
        <ActionLink href="/organizer/submit">List your event</ActionLink>
      </div>
      <dl>
        <div><dt>01 / Sell</dt><dd>Ticket tiers, Mobile Money and card payments.</dd></div>
        <div><dt>02 / Host</dt><dd>Private Rooms, guest updates and gate check-in.</dd></div>
        <div><dt>03 / Learn</dt><dd>Sales, promoter performance and attendance.</dd></div>
      </dl>
    </section>

    <footer className="night-footer compact-footer"><BrandMark /><p>Accra nights. From the first plan to the last track.</p><div><Link href="/admin/login">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
  </main>;
}
