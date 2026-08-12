import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeCheck, Camera, LockKeyhole, Send, Ticket } from "lucide-react";
import EventExplorer from "./event-explorer";
import { eventImageSrcSet, eventImageUrl } from "./event-images";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";

function BrandMark() {
  return <span className="night-brand" aria-label="BeCore Tickets"><b>B</b><span>BeCore<br />Tickets</span></span>;
}

function RoomPhone({ eventTitle, heroImage, conversation }: { eventTitle: string; heroImage: string; conversation: "arrival" | "inside" }) {
  return <article className={`room-product-phone room-product-phone--${conversation}`}>
    <div className="room-product-phone__hardware" aria-hidden="true"><span>9:2{conversation === "arrival" ? "1" : "4"}</span><i /><b>5G</b></div>
    <div className="room-product-phone__screen">
      <header className="room-product-phone__header"><div><small>The Room</small><b>{eventTitle}</b></div><span>{conversation === "arrival" ? "18" : "24"} online</span></header>
      <div className="room-product-phone__stream">
        {conversation === "arrival" ? <>
          <article className="scene-host"><BadgeCheck size={14} /><div><small>HOST UPDATE · 9:14 PM</small><p>Doors are open. Main set at 11:30. Pace yourselves; we know you won&apos;t.</p></div></article>
          <article className="scene-message"><span>KM</span><div className="scene-message__body"><div className="scene-message__bubble"><small>Kofi · 9:18 PM</small><p>Who is actually in Osu already?</p></div><div className="scene-message__reactions" aria-label="4 laughing reactions"><i>😂</i><b>4</b></div></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><div className="scene-message__bubble"><small>You · 9:19 PM</small><p>“Five minutes away” in the spiritual sense.</p></div><div className="scene-message__reactions" aria-label="2 crying reactions"><i>😭</i><b>2</b></div></div></article>
          <article className="scene-message"><span>YA</span><div className="scene-message__body"><div className="scene-message__bubble"><small>Yaw · 9:22 PM</small><p>Okay fine. Leaving now.</p></div><div className="scene-message__reactions" aria-label="3 fire reactions"><i>🔥</i><b>3</b></div></div></article>
        </> : <>
          <article className="scene-message"><span>AM</span><div className="scene-message__body"><div className="scene-message__bubble"><small>Ama · 10:42 PM</small><p>Front left is the move tonight.</p></div><div className="scene-message__reactions" aria-label="6 watching reactions"><i>👀</i><b>6</b></div></div></article>
          <article className="scene-flash"><img src={eventImageUrl(heroImage, 520)} alt="Flash shared inside The Room" loading="lazy" decoding="async" /><div><span><Camera size={12} /> Ama dropped a Flash</span><small>Gone when the Room closes</small></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><div className="scene-message__bubble"><small>You · 10:44 PM</small><p>Found you. This set is ridiculous.</p></div><div className="scene-message__reactions" aria-label="5 fire reactions"><i>🔥</i><b>5</b></div></div></article>
          <article className="scene-host scene-host--compact"><BadgeCheck size={14} /><div><small>HOST UPDATE · 10:47 PM</small><p>Last entry moves to Gate 2.</p></div></article>
        </>}
      </div>
      <div className="room-product-phone__composer"><Camera size={17} /><span>Message The Room</span><Send size={16} /></div>
    </div>
    <span className="room-product-phone__home" aria-hidden="true" />
  </article>;
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
      <nav aria-label="Main navigation"><Link href="/events">The Drop</Link><Link href="/about">About us</Link><Link href="/organizer/submit">Organisers</Link></nav>
      <div className="night-header__actions"><Link href="/my-nights" className="night-ticket-link"><Ticket size={16} /> My Nights</Link></div>
    </header>

    <section className="compact-hero">
      <img src={eventImageUrl(heroImage, 1600, 78)} srcSet={eventImageSrcSet(heroImage, [960, 1280, 1600])} sizes="100vw" alt={featured ? `Atmosphere for ${featured.title}` : "A crowd under warm stage lights at night"} fetchPriority="high" decoding="async" />
      <div className="compact-hero__shade" />
      <div className="compact-hero__copy">
        <p className="night-kicker"><span /> Accra&apos;s edited night out</p>
        <h1>{featured?.title ?? "Plans, sorted."}</h1>
        <p>{featured ? `${featured.vibe} · ${featured.fullDate} · ${featured.venue}, ${featured.area}` : "The next verified Drop is getting dressed."}</p>
        {featured ? <div><Link href={`/event/${featured.slug}`}>See the night <ArrowRight size={16} /></Link><Link href={`/checkout/${featured.slug}`}>Get tickets <Ticket size={15} /></Link></div> : <Link href="/organizer/submit" className="compact-hero__single">Submit a night <ArrowUpRight size={15} /></Link>}
      </div>
      {featured ? <p className="compact-hero__price">From <b>GH₵{featured.price}</b></p> : null}
    </section>

    <section className="night-drop night-drop--compact" id="drop">
      <div className="compact-section-head" data-scroll-reveal><div><p className="night-kicker"><span /> The Drop</p><h2>Find your night.</h2></div><Link href="/events">See all nights <ArrowUpRight size={15} /></Link></div>
      <EventExplorer events={events.slice(0, 6)} />
    </section>

    <section className="room-product-scene" id="the-room" data-scroll-reveal>
      <div className="room-product-scene__copy"><p className="night-kicker"><span /> Included with your ticket</p><h2>The night has a Room.</h2><p>Plan together, hear it straight from the Host and drop Flashes into the same conversation. The chat remembers. The photos know when to leave.</p><span><LockKeyhole size={13} /> No ticket, no lurking. Very civilised.</span></div>
      <div className="room-product-scene__phones" aria-label="Two previews of ticket-holder conversations in The Room">
        <RoomPhone eventTitle={featured?.title ?? "After Dark"} heroImage={heroImage} conversation="arrival" />
        <RoomPhone eventTitle={featured?.title ?? "After Dark"} heroImage={heroImage} conversation="inside" />
      </div>
    </section>

    <footer className="night-footer compact-footer"><BrandMark /><p>Editorial nightlife outside. Private event access inside.</p><div><Link href="/admin/login">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link></div></footer>
  </main>;
}
