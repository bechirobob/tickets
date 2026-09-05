import BrandLogo from "./brand-logo";
import Image from "next/image";
import Link from "next/link";
import { ChartNoAxesCombined, MapPin, MessageCircle, Ticket } from "lucide-react";
import { ActionLink } from "./action";
import ActiveNightExperience from "./active-night-experience";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";
import PublicNavigation from "./mobile-navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await getPublicEvents();

  return <main className="night-home compact-home discovery-home" id="main-content">
    <a className="discovery-skip" href="#drop">Skip to events</a>
    <ScrollReveal />
    <header className="night-header">
      <Link href="/" className="night-brand-link"><BrandLogo prominent /></Link>
      <div className="night-header__actions"><nav className="night-desktop-links" aria-label="Explore"><Link href="/events">The Drop</Link><Link href="/hosts">Hosts</Link><Link href="/my-nights">My Nights</Link></nav><span className="night-city"><MapPin size={14} aria-hidden="true" /> Accra, GH</span><PublicNavigation /></div>
    </header>

    <ActiveNightExperience events={events} />

    <section className="organizer-intelligence backstage-bridge" data-scroll-reveal>
      <div className="organizer-intelligence__copy">
        <p className="night-kicker"><span /> Behind the night / Hosts &amp; organisers</p>
        <h2>You bring the crowd.<br />We’ll mind the details.</h2>
        <p>Sell the tickets, keep guests in the loop and get the door moving. You have a party to throw.</p>
        <div className="backstage-bridge__actions"><ActionLink href="/organizer/submit">List your event</ActionLink><ActionLink href="/hosts" variant="text">Meet the Hosts</ActionLink></div>
      </div>
      <figure className="backstage-bridge__image"><Image src="/atmospheres/behind-the-night.webp" width={1100} height={733} sizes="(max-width: 700px) 100vw, 46vw" alt="" aria-hidden="true" unoptimized /><figcaption>Good nights don’t happen by accident.</figcaption></figure>
      <dl>
        <div><dt><Ticket aria-hidden="true" size={20} /> Sell tickets</dt><dd>MoMo, cards and ticket tiers. Give the group chat a deadline.</dd></div>
        <div><dt><MessageCircle aria-hidden="true" size={20} /> Run the night</dt><dd>Guest updates, a private Room and passes ready for the door.</dd></div>
        <div><dt><ChartNoAxesCombined aria-hidden="true" size={20} /> Plan the next</dt><dd>See what sold, who brought the crowd and when they showed up.</dd></div>
      </dl>
    </section>

    <footer className="night-footer compact-footer"><BrandLogo prominent /><p>Accra, we’re going out. Tell the group chat.</p><div><Link href="/admin/login">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
  </main>;
}
