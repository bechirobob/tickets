import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CalendarDays, Clock3, Gem, MapPin, MessageCircle, ShieldCheck, Ticket } from "lucide-react";
import { notFound } from "next/navigation";
import { eventImageSrcSet, eventImageUrl } from "../../event-images";
import { findCuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { findPrimaryHost } from "../../../lib/event-experience";
import EventActions from "./event-actions";
import MemberActions from "../../member-actions";
import WaitlistControl from "./waitlist-control";
import PublicNavigation from "../../mobile-navigation";

export const dynamic = "force-dynamic";

const origin = "https://tickets.becoreops.com";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) return { title: "Night not found", robots: { index: false, follow: false } };
  const description = `${event.quip} ${event.fullDate} at ${event.venue}, ${event.area}. Tickets from ${formatGhanaCedis(event.priceFromMinor)}.`;
  const canonical = `/event/${event.slug}`;
  const image = eventImageUrl(event.image, 1440, 82);
  return {
    title: event.title,
    description,
    alternates: { canonical },
    robots: event.isTestEvent ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "en_GH",
      siteName: "BeCore Tickets",
      title: `${event.title} · BeCore Tickets`,
      description,
      url: canonical,
      images: [{ url: image, width: 1440, height: 960, alt: `Atmosphere for ${event.title}` }],
    },
    twitter: { card: "summary_large_image", title: `${event.title} · BeCore Tickets`, description, images: [image] },
  };
}

export default async function EventPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const promoterCode = query.ref?.trim().toUpperCase().replace(/[^A-Z0-9_-]/gu, "").slice(0, 32) ?? "";
  const { env } = await import("cloudflare:workers");
  const [event, host] = await Promise.all([findCuratedEvent(slug), findPrimaryHost(env.DB, slug)]);
  if (!event) notFound();
  const available = event.ticketTiers.some((tier) => tier.status === "available");
  const structuredEvent = event.isTestEvent ? null : {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: `${event.quip} ${event.note}`,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: event.eventState === "cancelled" ? "https://schema.org/EventCancelled" : event.eventState === "postponed" ? "https://schema.org/EventPostponed" : event.eventState === "rescheduled" ? "https://schema.org/EventRescheduled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: [eventImageUrl(event.image, 1440, 82)],
    location: { "@type": "Place", name: event.venue, address: { "@type": "PostalAddress", addressLocality: event.area, addressRegion: "Greater Accra", addressCountry: "GH" } },
    organizer: host ? { "@type": "Organization", name: host.name, url: `${origin}/hosts/${host.slug}` } : { "@type": "Organization", name: "BeCore Tickets", url: origin },
    offers: event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => ({
      "@type": "Offer",
      name: tier.name,
      price: (tier.priceMinor / 100).toFixed(2),
      priceCurrency: "GHS",
      url: `${origin}/checkout/${event.slug}?tier=${encodeURIComponent(tier.id)}`,
      availability: tier.status === "available" ? "https://schema.org/InStock" : tier.status === "sold_out" ? "https://schema.org/SoldOut" : "https://schema.org/PreOrder",
      validFrom: event.salesOpenAt ?? undefined,
    })),
  };

  return <main className="event-page compact-event-page">
    {structuredEvent ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredEvent).replace(/</gu, "\\u003c") }} /> : null}
    <header className="sub-header"><Link href="/events" className="back-link"><ArrowLeft size={17} /> The Drop</Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><span className="public-header-actions"><EventActions title={event.title} eventSlug={event.slug} /><PublicNavigation /></span></header>

    <section className="compact-event-hero"><img src={eventImageUrl(event.image, 1440, 78)} srcSet={eventImageSrcSet(event.image, [720, 1080, 1440])} sizes="100vw" alt={`Atmosphere for ${event.title}`} fetchPriority="high" decoding="async" /><div /><article><p className="eyebrow">{event.isTestEvent ? "Working preview" : "BeCore pick"} · {event.vibe}</p><h1>{event.title}</h1><span>{event.fullDate} · {event.venue}, {event.area}</span></article></section>

    <section className="compact-event-layout">
      <article className="compact-event-main">
        {event.isTestEvent ? <div className="preview-event-notice"><strong>Preview event</strong><span>This is a working test listing, not a real scheduled event. Use it to try the complete BeCore Tickets journey.</span></div> : null}
        <div className="compact-event-facts"><span><CalendarDays size={16} /> {event.fullDate}</span><span><Clock3 size={16} /> {event.time}</span>{event.venueMapUrl ? <Link href={event.venueMapUrl} target="_blank" rel="noreferrer"><MapPin size={16} /> {event.venue}, {event.area}</Link> : <span><MapPin size={16} /> {event.venue}, {event.area}</span>}</div>
        <section className="compact-event-story"><p className="eyebrow">Why it made the list</p><h2>{event.quip} Also: good music, a managed entrance and an actual plan.</h2><p>{event.note} Expect a deliberate music programme and enough room for the night to find its rhythm before your shoes file a complaint.</p><dl><div><dt>Line-up</dt><dd>{event.lineup}</dd></div><div><dt>Entry</dt><dd>{event.ageRestriction} · Valid government-issued ID · One scan per admission</dd></div></dl></section>
        {host ? <section className="event-host"><div className="host-monogram">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p><BadgeCheck size={13} /> {host.verificationStatus === "verified" ? "Verified Host" : "Reviewed Host"}</p><h2>{host.name}</h2><span>{host.role} · {host.city}</span><Link href={`/hosts/${host.slug}`}>View Host <ArrowUpRight size={14} /></Link></div></section> : null}
      </article>

      <aside className="compact-ticket-panel">
        <div><p className="eyebrow">Choose your access</p>{event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => <section key={tier.id}><div><b>{tier.name}</b><span>{tier.description}{tier.status === "available" && tier.remainingAdmissions <= Math.max(5, Math.ceil(tier.capacityAdmissions * 0.1)) ? ` · Only ${tier.remainingAdmissions} left` : ""}</span>{tier.roomBadge === "VIP" ? <small className="tier-vip-note"><Gem size={11} /> VIP identity in The Room · private Host concierge when enabled</small> : null}</div><strong>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</strong></section>)}</div>
        {event.eventState === "cancelled" ? <p className="event-state-notice">This event has been cancelled. Existing customers will receive refund instructions.</p> : event.eventState === "postponed" ? <p className="event-state-notice">This event has been postponed. A new date will be published after confirmation.</p> : available ? <Link href={`/checkout/${slug}${promoterCode ? `?ref=${encodeURIComponent(promoterCode)}` : ""}`} className="checkout-link">Get tickets <Ticket size={17} /></Link> : <span className="checkout-link checkout-link--disabled">Tickets are not currently available</span>}
        <p className="secure-note"><ShieldCheck size={14} /> Secure checkout · Fresh QR · Screenshot confidence discouraged</p>
        <div className="ticket-unlocks"><MessageCircle size={17} /><span><b>Your ticket unlocks the night</b>My Nights, Before the Night, updates, The Room and Flashes.</span></div>
        <MemberActions eventSlug={event.slug} hostSlug={host?.slug} />
        <WaitlistControl eventSlug={event.slug} tiers={event.ticketTiers} />
      </aside>
    </section>
  </main>;
}
