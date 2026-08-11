import Link from "next/link";
import { ArrowDown, ArrowUpRight, Ticket } from "lucide-react";
import EventExplorer from "./event-explorer";
import { getPublicEvents } from "./events";

function BrandMark() {
  return (
    <span className="night-brand" aria-label="BeCore Tickets">
      <b>B</b>
      <span>BeCore<br />Tickets</span>
    </span>
  );
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const curatedEvents = await getPublicEvents();
  const featured = curatedEvents[0];

  return (
    <main className="night-home">
      <header className="night-header">
        <Link href="/" className="night-brand-link"><BrandMark /></Link>
        <nav aria-label="Main navigation">
          <Link href="#drop">The drop</Link>
          <Link href="#standard">Our standard</Link>
          <Link href="/organizer/submit">For organisers</Link>
        </nav>
        <div className="night-header__actions">
          <Link href="/tickets" className="night-ticket-link"><Ticket size={16} /> My tickets</Link>
          <Link href="/organizer/submit" className="night-submit">Submit a party <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <section className="night-hero">
        <img src={featured.image} alt="A crowd under warm stage lights at night" />
        <div className="night-hero__shade" />
        <div className="night-hero__copy">
          <p className="night-kicker"><span /> Accra · Week 33</p>
          <h1>Plans,<br />sorted.</h1>
          <p>Four parties. We did the scrolling.</p>
          <Link href="#drop" className="night-scroll">Pick your night <ArrowDown size={17} /></Link>
        </div>
        <Link href={`/event/${featured.slug}`} className="night-featured">
          <span className="night-featured__label">BeCore pick · 01</span>
          <strong>{featured.title}</strong>
          <span>{featured.day} · {featured.venue}, {featured.area}</span>
          <i><ArrowUpRight size={22} /></i>
        </Link>
        <p className="night-hero__side">NO FILLER · JUST GOOD NIGHTS</p>
      </section>

      <section className="night-ticker" aria-label="This week's edit">
        <span>THIS WEEK</span>
        <b>04 handpicked parties</b>
        <i>•</i>
        <b>00 awkward mixers</b>
        <i>•</i>
        <b>Tickets in under two minutes</b>
      </section>

      <section className="night-drop" id="drop">
        <div className="night-section-head">
          <div>
            <p className="night-kicker"><span /> The weekly edit</p>
            <h2>Pick your<br />problem.</h2>
          </div>
          <p>Accra gave us options. We kept the good ones.</p>
        </div>
        <EventExplorer events={curatedEvents} />
      </section>

      <section className="night-standard" id="standard">
        <div className="night-standard__copy">
          <p className="night-kicker"><span /> Our one serious bit</p>
          <h2>Good parties.<br />No paid opinions.</h2>
          <p>We check the organiser, venue, ticket terms and the actual plan. Money can buy an ad. It cannot buy a place in the edit.</p>
        </div>
        <div className="night-standard__rules">
          <article><b>01</b><span>Real organisers</span></article>
          <article><b>02</b><span>Checked venues</span></article>
          <article><b>03</b><span>Clear tickets</span></article>
          <article><b>04</b><span>Worth the outfit</span></article>
        </div>
      </section>

      <section className="night-pitch">
        <div>
          <p className="night-kicker"><span /> Organisers, hello</p>
          <h2>Got a party<br />worth leaving<br />home for?</h2>
        </div>
        <div className="night-pitch__copy">
          <p>Show us. “Good vibes” is not a production plan.</p>
          <Link href="/organizer/submit">Submit your party <ArrowUpRight size={17} /></Link>
        </div>
      </section>

      <footer className="night-footer">
        <BrandMark />
        <p>Accra&apos;s short list for a good night.</p>
        <div>
          <Link href="/tickets">My tickets</Link>
          <Link href="/organizer/submit">Organisers</Link>
          <Link href="/privacy">Privacy</Link>
          <span>A BeCoreOps platform</span>
        </div>
      </footer>
    </main>
  );
}
