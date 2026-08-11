import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock3, MapPin, MessageCircle, ShieldCheck, Ticket } from "lucide-react";
import { notFound } from "next/navigation";
import { findCuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import EventActions from "./event-actions";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) notFound();

  return (
    <main className="event-page">
      <header className="sub-header">
        <Link href="/#drop" className="back-link"><ArrowLeft size={17} /> The weekly edit</Link>
        <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
        <EventActions title={event.title} />
      </header>

      <section className="event-hero">
        <img src={event.image} alt={`Atmosphere for ${event.title}`} />
        <div className="event-hero__overlay">
          <p className="eyebrow">BeCore pick · {event.sequence} · {event.vibe}</p>
          <h1>{event.title}</h1>
        </div>
      </section>

      <section className="event-layout">
        <article className="event-story">
          {event.eventState === "rescheduled" && event.rescheduledFrom ? <p className="event-state-notice">New date confirmed. This event moved from {new Intl.DateTimeFormat("en-GH", { dateStyle: "full", timeZone: "Africa/Accra" }).format(new Date(event.rescheduledFrom))}; existing paid tickets remain valid.</p> : null}
          <div className="event-facts">
            <div><CalendarDays /><span><small>Date</small>{event.fullDate}</span></div>
            <div><Clock3 /><span><small>Time</small>{event.time}</span></div>
            <div><MapPin /><span><small>Venue</small>{event.venue}, {event.area}</span></div>
          </div>

          <div className="story-block">
            <p className="eyebrow">Why it made the list</p>
            <h2>Good music. Close friends. Nobody holding the microphone hostage.</h2>
            <p>{event.note} Expect a deliberate music programme, a properly managed entrance and enough room for the night to find its rhythm.</p>
            <p>Doors open at the stated time—not “Accra time.” Valid government-issued ID is required. Entry is strictly {event.ageRestriction}, and every admission permits one valid scan at the gate.</p>
          </div>

          <div className="story-block story-block--lineup">
            <p className="eyebrow">Confirmed line-up</p>
            <p>{event.lineup}</p>
          </div>

          <div className="venue-block">
            <div>
              <p className="eyebrow">The venue</p>
              <h3>{event.venue}, {event.area}</h3>
              <p>Accra, Ghana · Exact venue location supplied by the organiser</p>
            </div>
            {event.venueMapUrl ? <Link href={event.venueMapUrl} target="_blank" rel="noreferrer">Open map</Link> : <span>Map pending</span>}
          </div>
        </article>

        <aside className="ticket-panel">
          <p className="eyebrow">Tickets</p>
          {event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => (
            <div className={`ticket-option${tier.status === "sold_out" ? " ticket-option--sold-out" : ""}`} key={tier.id}>
              <div><strong>{tier.name}</strong><span>{tier.description}</span></div>
              <b>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</b>
            </div>
          ))}
          {event.eventState === "cancelled" ? <p className="event-state-notice">This event has been cancelled. Existing customers will receive refund instructions.</p> : event.eventState === "postponed" ? <p className="event-state-notice">This event has been postponed. A new date will be published after confirmation.</p> : event.ticketTiers.some((tier) => tier.status === "available") ? <Link href={`/checkout/${slug}`} className="checkout-link">Choose your night <Ticket size={18} /></Link> : <span className="checkout-link checkout-link--disabled">Tickets are not currently available</span>}
          <p className="secure-note"><ShieldCheck size={15} /> Secure checkout · Instant QR ticket</p>
          <div className="room-promise"><MessageCircle size={17} /><span><b>The Room opens after checkout</b>Talk with verified attendees and receive organiser updates.</span></div>
        </aside>
      </section>
    </main>
  );
}
