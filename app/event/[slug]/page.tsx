import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CalendarDays, Clock3, MapPin, MessageCircle, ShieldCheck, Ticket } from "lucide-react";
import { notFound } from "next/navigation";
import { findCuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { findPrimaryHost } from "../../../lib/event-experience";
import EventActions from "./event-actions";
import MemberActions from "../../member-actions";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = await import("cloudflare:workers");
  const [event, host] = await Promise.all([findCuratedEvent(slug), findPrimaryHost(env.DB, slug)]);
  if (!event) notFound();
  const available = event.ticketTiers.some((tier) => tier.status === "available");

  return <main className="event-page compact-event-page">
    <header className="sub-header"><Link href="/events" className="back-link"><ArrowLeft size={17} /> The Drop</Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><EventActions title={event.title} /></header>

    <section className="compact-event-hero"><img src={event.image} alt={`Atmosphere for ${event.title}`} /><div /><article><p className="eyebrow">{event.isTestEvent ? "Working preview" : "BeCore pick"} · {event.vibe}</p><h1>{event.title}</h1><span>{event.fullDate} · {event.venue}, {event.area}</span></article></section>

    <section className="compact-event-layout">
      <article className="compact-event-main">
        {event.isTestEvent ? <div className="preview-event-notice"><strong>Preview event</strong><span>This is a working test listing, not a real scheduled event. Use it to try the complete BeCore Tickets journey.</span></div> : null}
        <div className="compact-event-facts"><span><CalendarDays size={16} /> {event.fullDate}</span><span><Clock3 size={16} /> {event.time}</span>{event.venueMapUrl ? <Link href={event.venueMapUrl} target="_blank" rel="noreferrer"><MapPin size={16} /> {event.venue}, {event.area}</Link> : <span><MapPin size={16} /> {event.venue}, {event.area}</span>}</div>
        <section className="compact-event-story"><p className="eyebrow">Why it made the list</p><h2>Good music. A managed entrance. A night with an actual plan.</h2><p>{event.note} Expect a deliberate music programme and enough room for the night to find its rhythm.</p><dl><div><dt>Line-up</dt><dd>{event.lineup}</dd></div><div><dt>Entry</dt><dd>{event.ageRestriction} · Valid government-issued ID · One scan per admission</dd></div></dl></section>
        {host ? <section className="event-host"><div className="host-monogram">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p><BadgeCheck size={13} /> {host.verificationStatus === "verified" ? "Verified Host" : "Reviewed Host"}</p><h2>{host.name}</h2><span>{host.role} · {host.city}</span><Link href={`/hosts/${host.slug}`}>View Host <ArrowUpRight size={14} /></Link></div></section> : null}
      </article>

      <aside className="compact-ticket-panel">
        <div><p className="eyebrow">Choose your access</p>{event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => <section key={tier.id}><div><b>{tier.name}</b><span>{tier.description}</span></div><strong>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</strong></section>)}</div>
        {event.eventState === "cancelled" ? <p className="event-state-notice">This event has been cancelled. Existing customers will receive refund instructions.</p> : event.eventState === "postponed" ? <p className="event-state-notice">This event has been postponed. A new date will be published after confirmation.</p> : available ? <Link href={`/checkout/${slug}`} className="checkout-link">Get tickets <Ticket size={17} /></Link> : <span className="checkout-link checkout-link--disabled">Tickets are not currently available</span>}
        <p className="secure-note"><ShieldCheck size={14} /> Secure checkout · Instant QR entry</p>
        <div className="ticket-unlocks"><MessageCircle size={17} /><span><b>Your ticket unlocks the night</b>My Nights, Before the Night, updates, The Room and Flashes.</span></div>
        <MemberActions eventSlug={event.slug} hostSlug={host?.slug} />
      </aside>
    </section>
  </main>;
}
