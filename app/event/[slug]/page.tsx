import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock3, MapPin, Share2, ShieldCheck, Ticket } from "lucide-react";
import { getCuratedEvent } from "../../events";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getCuratedEvent(slug);

  return (
    <main className="event-page">
      <header className="sub-header">
        <Link href="/#drop" className="back-link"><ArrowLeft size={17} /> The weekly edit</Link>
        <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
        <button className="icon-text"><Share2 size={17} /> Share</button>
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
          <div className="event-facts">
            <div><CalendarDays /><span><small>Date</small>{event.fullDate}</span></div>
            <div><Clock3 /><span><small>Time</small>{event.time}</span></div>
            <div><MapPin /><span><small>Venue</small>{event.venue}, {event.area}</span></div>
          </div>

          <div className="story-block">
            <p className="eyebrow">Why it made the list</p>
            <h2>Good music. Close friends. Nobody holding the microphone hostage.</h2>
            <p>{event.note} Expect a deliberate music programme, a properly managed entrance and enough room for the night to find its rhythm.</p>
            <p>Doors open at the stated time—not “Accra time.” Valid government-issued ID is required. Entry is strictly {event.vibe === "Day party" ? "18+" : "21+"}, and every ticket permits one valid scan at the gate.</p>
          </div>

          <div className="venue-block">
            <div>
              <p className="eyebrow">The venue</p>
              <h3>{event.venue}, {event.area}</h3>
              <p>Accra, Ghana · Venue details confirmed</p>
            </div>
            <Link href="https://maps.google.com" target="_blank">Open map</Link>
          </div>
        </article>

        <aside className="ticket-panel">
          <p className="eyebrow">Tickets</p>
          <div className="ticket-option">
            <div><strong>General admission</strong><span>For people who can arrive before the plot thickens</span></div>
            <b>GH₵{event.price}</b>
          </div>
          <div className="ticket-option">
            <div><strong>VIP</strong><span>Priority entry + less queue, more composure</span></div>
            <b>GH₵250</b>
          </div>
          <div className="ticket-option">
            <div><strong>Table for 5</strong><span>Five VIP entries. Group-chat arithmetic solved.</span></div>
            <b>GH₵1,800</b>
          </div>
          <Link href={`/checkout/${slug}`} className="checkout-link">Choose your night <Ticket size={18} /></Link>
          <p className="secure-note"><ShieldCheck size={15} /> Secure checkout · Instant QR ticket</p>
        </aside>
      </section>
    </main>
  );
}
