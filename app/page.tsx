import Link from "next/link";
import { ChartNoAxesCombined, MapPin, MessageCircle, Ticket } from "lucide-react";
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
        <h2>You bring the crowd.<br />We’ll mind the details.</h2>
        <p>Sell the tickets, keep guests in the loop and get the door moving. You have a party to throw.</p>
        <ActionLink href="/organizer/submit">List your event</ActionLink>
      </div>
      <dl>
        <div><dt><Ticket aria-hidden="true" size={20} /> Sell tickets</dt><dd>MoMo, cards and ticket tiers. Give the group chat a deadline.</dd></div>
        <div><dt><MessageCircle aria-hidden="true" size={20} /> Run the night</dt><dd>Guest updates, a private Room and passes ready for the door.</dd></div>
        <div><dt><ChartNoAxesCombined aria-hidden="true" size={20} /> Plan the next</dt><dd>See what sold, who brought the crowd and when they showed up.</dd></div>
      </dl>
    </section>

    <footer className="night-footer compact-footer"><BrandMark /><p>Accra, we’re going out. Tell the group chat.</p><div><Link href="/admin/login">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
  </main>;
}
