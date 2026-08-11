import Link from "next/link";
import { ArrowDown, ArrowUpRight, LockKeyhole, MessageCircle, ShieldCheck, Ticket } from "lucide-react";
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
          <Link href="#the-room">The Room</Link>
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
        <b>A private Room with every ticket</b>
        <i>•</i>
        <b>04 handpicked parties</b>
        <i>•</i>
        <b>00 awkward mixers</b>
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

      <section className="night-room-tease" id="the-room">
        <div className="night-room-tease__copy">
          <p className="night-kicker"><span /> BeCore exclusive</p>
          <h2>The chat your<br />ticket gets<br />you into.</h2>
          <p>Meet the crowd, sort the link-up and get updates straight from the organiser. Every event has its own private conversation, open only to verified ticket holders.</p>
          <div className="night-room-tease__actions">
            <Link href="#drop">Find your Room <ArrowUpRight size={17} /></Link>
            <span><LockKeyhole size={14} /> No ticket. No lurking.</span>
          </div>
        </div>

        <div className="night-room-peek" aria-label="A preview of The Room conversation">
          <header>
            <div><i /><span><b>The Room</b><small>After Dark: Osu · ticket holders only</small></span></div>
            <span className="night-room-peek__preview"><ShieldCheck size={17} /> Preview</span>
          </header>
          <div className="night-room-peek__stream">
            <p className="night-room-peek__day">Tonight · 10:00 PM</p>
            <article className="night-room-message night-room-message--left">
              <span>Where&apos;s everyone meeting first?</span>
              <small>9:42 PM</small>
              <i>🔥 4</i>
            </article>
            <article className="night-room-message night-room-message--right">
              <span>Outside the venue at 10. I&apos;ll drop the spot here 👀</span>
              <small>9:43 PM</small>
            </article>
            <aside className="night-room-update">
              <MessageCircle size={16} />
              <span><b>Organiser update</b>Doors open at 10. Your QR must be ready at the gate.</span>
            </aside>
            <article className="night-room-message night-room-message--left night-room-message--last">
              <span>Okay, this just saved the group chat 😂</span>
              <small>9:45 PM</small>
              <i>❤️ 7</i>
            </article>
          </div>
          <footer className="night-room-peek__lock">
            <LockKeyhole size={16} />
            <span><b>Conversation locked</b>Your verified ticket is the key.</span>
          </footer>
        </div>
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
