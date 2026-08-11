import Link from "next/link";
import { ArrowDown, ArrowUpRight, BadgeCheck, BatteryFull, CheckCheck, ChevronLeft, CirclePlus, LockKeyhole, MapPin, MessageCircle, Mic, ShieldCheck, Signal, Ticket, Wifi } from "lucide-react";
import EventExplorer from "./event-explorer";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";

function BrandMark() {
  return (
    <span className="night-brand" aria-label="BeCore Tickets">
      <b>B</b>
      <span>BeCore<br />Tickets</span>
    </span>
  );
}

function currentWeekNumber() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const curatedEvents = await getPublicEvents();
  const featured = curatedEvents[0];
  const previewCount = curatedEvents.filter((event) => event.isTestEvent).length;
  const heroImage = featured?.image ?? "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88";

  return (
    <main className="night-home">
      <ScrollReveal />
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
        <img src={heroImage} alt="A crowd under warm stage lights at night" />
        <div className="night-hero__shade" />
        <div className="night-hero__copy">
          <p className="night-kicker"><span /> Accra · Week {currentWeekNumber()}</p>
          <h1>Plans,<br />sorted.</h1>
          <p>{featured ? `${curatedEvents.length} ${curatedEvents.length === 1 ? "party" : "parties"}. We did the scrolling.` : "The next verified drop is being prepared."}</p>
          <Link href={featured ? "#drop" : "/organizer/submit"} className="night-scroll">{featured ? "Pick your night" : "Submit a party"} <ArrowDown size={17} /></Link>
        </div>
        {featured ? <Link href={`/event/${featured.slug}`} className="night-featured">
          <span className="night-featured__label">{featured.isTestEvent ? "Working preview" : "BeCore pick"} · 01</span>
          <strong>{featured.title}</strong>
          <span>{featured.day} · {featured.venue}, {featured.area}</span>
          <i><ArrowUpRight size={22} /></i>
        </Link> : <div className="night-featured night-featured--empty"><span className="night-featured__label">Event desk</span><strong>The list is temporarily unavailable.</strong><span>We are reconnecting the event catalogue.</span></div>}
        <p className="night-hero__side">{previewCount ? "WORKING PREVIEWS · REAL FLOW" : "CURATED NIGHTS · GOOD PLANS"}</p>
      </section>

      <section className="night-ticker" aria-label="This week's edit">
        <span>THIS WEEK</span>
        <b>A private Room with every ticket</b>
        <i>•</i>
        <b>{previewCount ? `${String(previewCount).padStart(2, "0")} working preview ${previewCount === 1 ? "party" : "parties"}` : `${String(curatedEvents.length).padStart(2, "0")} handpicked ${curatedEvents.length === 1 ? "party" : "parties"}`}</b>
        <i>•</i>
        <b>00 awkward mixers</b>
      </section>

      <section className="night-drop" id="drop">
        <div className="night-section-head" data-scroll-reveal>
          <div>
            <p className="night-kicker"><span /> The weekly edit</p>
            <h2>Pick your<br />problem.</h2>
          </div>
          <p>{previewCount ? "Working listings keep the complete booking flow open while the real calendar is being curated." : curatedEvents.length ? "Accra gave us options. We kept the good ones." : "Only verified events make the public list."}</p>
        </div>
        <EventExplorer events={curatedEvents} />
      </section>

      <section className="night-room-tease" id="the-room">
        <div className="night-room-tease__copy" data-scroll-reveal>
          <p className="night-kicker"><span /> BeCore exclusive</p>
          <h2>The chat your<br />ticket gets<br />you into.</h2>
          <p>Meet the crowd, sort the link-up and get updates straight from the organiser. Every event has its own private conversation, open only to verified ticket holders.</p>
          <div className="night-room-tease__actions">
            <Link href="#drop">Find your Room <ArrowUpRight size={17} /></Link>
            <span><LockKeyhole size={14} /> No ticket. No lurking.</span>
          </div>
        </div>

        <div className="night-room-showcase" data-scroll-reveal data-reveal-delay="1">
          <p><ShieldCheck size={14} /> Ticket-holder mobile preview</p>
          <div className="night-room-device" aria-label="A preview of The Room conversation inside a mobile device">
            <div className="night-room-device__status" aria-hidden="true">
              <span>9:41</span>
              <i><b /></i>
              <span><Signal size={11} /><Wifi size={12} /><BatteryFull size={15} /></span>
            </div>
            <div className="night-room-peek">
              <header>
                <div className="night-room-peek__identity">
                  <ChevronLeft size={18} />
                  <span className="night-room-peek__avatars" aria-hidden="true"><i>AM</i><i>KB</i></span>
                  <span><b>The Room <BadgeCheck size={13} /></b><small>{featured ? `${featured.title} · ticket holders only` : "Your event · ticket holders only"}</small></span>
                </div>
                <span className="night-room-peek__preview"><ShieldCheck size={14} /> Preview</span>
              </header>
              <div className="night-room-peek__stream">
                <p className="night-room-peek__day">Tonight · 9:41 PM</p>
                <article className="night-room-message night-room-message--left">
                  <p><b>Ama</b><time>9:42 PM</time></p>
                  <span>Where&apos;s everyone meeting first?</span>
                  <i>🔥 4</i>
                </article>
                <article className="night-room-message night-room-message--right">
                  <span>Outside the venue at 10. I&apos;ll drop the spot here 👀</span>
                  <small>9:43 PM <CheckCheck size={11} /></small>
                </article>
                <aside className="night-room-update">
                  <header><span><MessageCircle size={15} /><b>Organiser update</b></span><small><BadgeCheck size={11} /> Verified</small></header>
                  <p>Doors open at 10. Your QR must be ready at the gate.</p>
                  <footer><MapPin size={12} /> Main entrance · Gate 2</footer>
                </aside>
                <article className="night-room-message night-room-message--left night-room-message--last">
                  <p><b>Kojo</b><time>9:45 PM</time></p>
                  <span>Okay, this just saved the group chat 😂</span>
                  <i>❤️ 7</i>
                </article>
              </div>
              <div className="night-room-peek__lock"><LockKeyhole size={12} /> Preview locked · your ticket opens this Room</div>
              <footer className="night-room-peek__composer" aria-hidden="true">
                <CirclePlus size={19} />
                <span>Message The Room</span>
                <Mic size={17} />
              </footer>
            </div>
            <i className="night-room-device__home" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="night-standard" id="standard">
        <div className="night-standard__copy" data-scroll-reveal>
          <p className="night-kicker"><span /> Our one serious bit</p>
          <h2>Good parties.<br />No paid opinions.</h2>
          <p>We check the organiser, venue, ticket terms and the actual plan. Money can buy an ad. It cannot buy a place in the edit.</p>
        </div>
        <div className="night-standard__rules" data-scroll-reveal data-reveal-delay="1">
          <article><b>01</b><span>Real organisers</span></article>
          <article><b>02</b><span>Checked venues</span></article>
          <article><b>03</b><span>Clear tickets</span></article>
          <article><b>04</b><span>Worth the outfit</span></article>
        </div>
      </section>

      <section className="night-pitch">
        <div data-scroll-reveal>
          <p className="night-kicker"><span /> Organisers, hello</p>
          <h2>Got a party<br />worth leaving<br />home for?</h2>
        </div>
        <div className="night-pitch__copy" data-scroll-reveal data-reveal-delay="1">
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
