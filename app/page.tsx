import Link from "next/link";
import { ArrowRight, ArrowUpRight, Camera, LockKeyhole, MessageCircle, Ticket } from "lucide-react";
import EventExplorer from "./event-explorer";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";

function BrandMark() {
  return <span className="night-brand" aria-label="BeCore Tickets"><b>B</b><span>BeCore<br />Tickets</span></span>;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await getPublicEvents();
  const featured = events[0];
  const heroImage = featured?.image ?? "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88";

  return <main className="night-home compact-home">
    <ScrollReveal />
    <header className="night-header">
      <Link href="/" className="night-brand-link"><BrandMark /></Link>
      <nav aria-label="Main navigation"><Link href="/events">The Drop</Link><Link href="/hosts">Hosts</Link><Link href="/organizer/submit">Organisers</Link></nav>
      <div className="night-header__actions"><Link href="/my-nights" className="night-ticket-link"><Ticket size={16} /> My Nights</Link></div>
    </header>

    <section className="compact-hero">
      <img src={heroImage} alt={featured ? `Atmosphere for ${featured.title}` : "A crowd under warm stage lights at night"} />
      <div className="compact-hero__shade" />
      <div className="compact-hero__copy">
        <p className="night-kicker"><span /> Accra&apos;s edited night out</p>
        <h1>{featured?.title ?? "Plans, sorted."}</h1>
        <p>{featured ? `${featured.fullDate} · ${featured.venue}, ${featured.area}` : "The next verified Drop is being prepared."}</p>
        {featured ? <div><Link href={`/event/${featured.slug}`}>See the night <ArrowRight size={16} /></Link><Link href={`/checkout/${featured.slug}`}>Get tickets <Ticket size={15} /></Link></div> : <Link href="/organizer/submit" className="compact-hero__single">Submit a night <ArrowUpRight size={15} /></Link>}
      </div>
      {featured ? <p className="compact-hero__price">From <b>GH₵{featured.price}</b></p> : null}
    </section>

    <section className="night-drop night-drop--compact" id="drop">
      <div className="compact-section-head" data-scroll-reveal><div><p className="night-kicker"><span /> The Drop</p><h2>Find your night.</h2></div><Link href="/events">See all nights <ArrowUpRight size={15} /></Link></div>
      <EventExplorer events={events.slice(0, 6)} />
    </section>

    <section className="room-flashes-strip" id="the-room" data-scroll-reveal>
      <div><p className="night-kicker"><span /> Included with your ticket</p><h2>The Room meets Flashes.</h2><p>Make the plan in Chat. Catch the moment in Flashes. Both stay ticket-only; the pictures disappear when the Room closes.</p></div>
      <div className="room-flashes-strip__features">
        <article><MessageCircle size={19} /><div><b>The Room</b><span>Live chat and Night Updates from the Host.</span></div></article>
        <article><Camera size={19} /><div><b>Flashes</b><span>Temporary event photos with no BeCore download control.</span></div></article>
        <p><LockKeyhole size={13} /> No ticket. No access.</p>
      </div>
    </section>

    <footer className="night-footer compact-footer"><BrandMark /><p>Editorial nightlife outside. Private event access inside.</p><div><Link href="/events">The Drop</Link><Link href="/my-nights">My Nights</Link><Link href="/organizer/submit">Organisers</Link><Link href="/privacy">Privacy</Link></div></footer>
  </main>;
}
