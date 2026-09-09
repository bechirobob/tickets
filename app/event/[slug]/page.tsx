import RegistrationForm from "../../registration-form";
import { registrationSettings, registrationsOpen } from "../../../lib/registrations";
import BrandLogo from "../../brand-logo";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowUpRight, BadgeCheck, Gem, MessageCircle, Ribbon, ShieldCheck, Ticket } from "lucide-react";
import { notFound } from "next/navigation";
import { eventImageUrl } from "../../event-images";
import { findCuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { findPrimaryHost } from "../../../lib/event-experience";
import { ActionLink } from "../../action";
import EventActions from "./event-actions";
import MemberActions from "../../member-actions";
import WaitlistControl from "./waitlist-control";
import PublicNavigation from "../../mobile-navigation";
import EventCountdown from "./event-countdown";
import EventPerkIcon from "./event-perk-icon";
import { eventColourScheme, eventPresentationStyle } from "../../../lib/event-presentation";
import "./event-details.css";

export const dynamic = "force-dynamic";

const origin = "https://tickets.becoreops.com";

type EventPageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; register?: string }> };

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) return { title: "Night not found", robots: { index: false, follow: false } };
  const description = `${event.quip} ${event.fullDate} at ${event.venue}, ${event.area}.${event.dressCode ? ` Dress code: ${event.dressCode}.` : ""}${event.guestPerk ? ` ${event.guestPerk}` : ""}${event.registrationMode === "rsvp" ? " Free RSVP." : event.registrationMode === "interest" ? " Register for announcements." : event.scheduleStatus === "coming_soon" ? " Tickets coming soon." : ` Tickets from ${formatGhanaCedis(event.priceFromMinor)}.`}`;
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
      images: [{ url: image, alt: `Event poster for ${event.title}` }],
    },
    twitter: { card: "summary_large_image", title: `${event.title} · BeCore Tickets`, description, images: [image] },
  };
}

export default async function EventPage({ params, searchParams }: EventPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const promoterCode = query.ref?.trim().toUpperCase().replace(/[^A-Z0-9_-]/gu, "").slice(0, 32) ?? "";
  const { env } = await import("cloudflare:workers");
  const [event, host] = await Promise.all([findCuratedEvent(slug), findPrimaryHost(env.DB, slug)]);
  if (!event) notFound();
  const registration = await registrationSettings(env.DB, slug);
  const registrationMode = registration?.mode ?? "paid";
  const start = event.startsAt ? new Date(event.startsAt) : null;
  const calendarMonth = start ? new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Africa/Accra" }).format(start) : "";
  const calendarDay = start ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "Africa/Accra" }).format(start) : "";
  const eventTime = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Accra" });
  const formatTime = (date: Date) => eventTime.format(date).replace(":00", "").toUpperCase();
  const colourScheme = eventColourScheme(event);
  const poster = event.image.startsWith("/events/");
  const salesPending = event.scheduleStatus === "coming_soon" || event.scheduleStatus === "end_pending";
  const available = event.ticketTiers.some((tier) => tier.status === "available");
  const structuredEvent = event.isTestEvent || !event.startsAt ? null : {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: `${event.quip} ${event.note}`,
    startDate: event.startsAt,
    endDate: event.endsAt ?? undefined,
    eventStatus: event.eventState === "cancelled" ? "https://schema.org/EventCancelled" : event.eventState === "postponed" ? "https://schema.org/EventPostponed" : event.eventState === "rescheduled" ? "https://schema.org/EventRescheduled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: [eventImageUrl(event.image, 1440, 82)],
    location: { "@type": "Place", name: event.venue, address: { "@type": "PostalAddress", addressLocality: event.area, addressRegion: "Greater Accra", addressCountry: "GH" } },
    organizer: host ? { "@type": "Organization", name: host.name, url: `${origin}/hosts/${host.slug}` } : undefined,
    offers: registrationMode === 'interest' ? undefined : registrationMode === 'rsvp' ? [{ '@type': 'Offer', name: 'Free RSVP', price: '0', priceCurrency: 'GHS', url: `${origin}/event/${event.slug}` }] : event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => ({
      "@type": "Offer",
      name: tier.name,
      price: (tier.priceMinor / 100).toFixed(2),
      priceCurrency: "GHS",
      url: `${origin}/checkout/${event.slug}?tier=${encodeURIComponent(tier.id)}`,
      availability: tier.status === "available" ? "https://schema.org/InStock" : tier.status === "sold_out" ? "https://schema.org/SoldOut" : "https://schema.org/PreOrder",
      validFrom: event.salesOpenAt ?? undefined,
    })),
  };

  return <main className="event-page compact-event-page poster-event-page" data-colour-scheme={colourScheme} style={eventPresentationStyle(event)}>
    {structuredEvent ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredEvent).replace(/</gu, "\\u003c") }} /> : null}
    <header className="sub-header"><Link href="/events" className="back-link"><ArrowLeft size={17} /> The Drop</Link><Link href="/" className="brand-mark"><BrandLogo /></Link><span className="public-header-actions"><PublicNavigation /></span></header>
    <div className="event-detail-toolbar"><EventActions title={event.title} eventSlug={event.slug} /></div>

    <div className="event-detail-layout">
      <figure className={`event-detail-poster${poster ? " event-detail-poster--portrait" : ""}`}><Image src={eventImageUrl(event.image, 1200, 82)} width={poster ? 960 : 1200} height={poster ? 1423 : 900} sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1100px) 48vw, 540px" alt={`Event poster for ${event.title}`} priority unoptimized /></figure>
      <section className="event-detail-overview" aria-labelledby="event-title">
        <p className="eyebrow">{event.vibe}{event.isVerified ? <span className="event-detail-verified"><BadgeCheck size={15} aria-hidden="true" /> Verified event</span> : null}</p><h1 id="event-title">{event.title}</h1>
        <div className="event-detail-facts">
          {start && event.startsAt ? <div className="event-date-line">
            <time className="event-date-display" dateTime={event.startsAt} aria-label={event.fullDate}><b>{calendarDay}</b><span><strong>{calendarMonth}</strong><small>{event.day} · {start.getUTCFullYear()}</small></span></time>
            <div className="event-hours" aria-label={`${formatTime(start)}${event.endsAt ? ` to ${formatTime(new Date(event.endsAt))}` : " onwards"}, Accra time`}><span><b>{formatTime(start)}</b><small>Doors open</small></span>{event.endsAt ? <><i aria-hidden="true">—</i><span><b>{formatTime(new Date(event.endsAt))}</b><small>Last dance</small></span></> : null}</div>
          </div> : <div className="event-coming-soon"><h2>Coming soon</h2><p>Good plans take a minute. The date drops here first.</p></div>}
          {event.startsAt ? <a className="event-detail-calendar" href={`/api/calendar/${event.slug}`}>Add to calendar <ArrowUpRight size={14} aria-hidden="true" /></a> : null}
          <dl className="event-practical-details">
            <div><dt>Find us</dt><dd>{event.venueMapUrl ? <Link href={event.venueMapUrl} target="_blank" rel="noreferrer" className="event-detail-venue">{event.venue}<ArrowUpRight size={15} aria-hidden="true" /></Link> : <strong>{event.venue}</strong>}<span>{event.area}</span></dd></div>
            {event.dressCode ? <div className="event-dress-code"><dt>Dress code</dt><dd><strong>{event.dressCode}</strong>{/^light pink\s*(?:&|and)\s*white$/iu.test(event.dressCode) ? <span className="event-dress-swatches" aria-hidden="true"><i /><i /></span> : null}</dd></div> : null}
          </dl>
          {event.guestPerk ? <p className="event-guest-perk"><EventPerkIcon perk={event.guestPerk} /><span>{event.guestPerk}</span></p> : null}
          {event.awarenessNote ? <p className="event-awareness-note"><Ribbon size={19} strokeWidth={1.7} aria-hidden="true" />{event.awarenessNote}</p> : null}
        </div>
        <EventCountdown startsAt={event.startsAt} endsAt={event.endsAt} eventState={event.eventState} isPreview={event.isTestEvent} />
        {event.isTestEvent ? <p className="event-detail-preview"><strong>Preview event</strong> · Sample date and tickets for trying BeCore. This is not a live event booking.</p> : null}
      </section>
      <article className="compact-event-main event-detail-story">
        <section className="compact-event-story"><p className="eyebrow">About the night</p>{event.quip ? <h2>{event.quip}</h2> : null}<p>{event.note}</p><dl><div><dt>Line-up</dt><dd>{event.lineup}</dd></div>{!salesPending ? <div><dt>Entry</dt><dd>{event.ageRestriction} · Valid government-issued ID · One scan per admission</dd></div> : null}</dl></section>
        {host ? <section className="event-host"><div className="host-monogram">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p><BadgeCheck size={13} /> {host.verificationStatus === "verified" ? "Verified Host" : "Reviewed Host"}</p><h2>{host.name}</h2><span>{host.role} · {host.city}</span><Link href={`/hosts/${host.slug}`}>View Host <ArrowUpRight size={14} /></Link></div></section> : null}
      </article>

      <aside className="compact-ticket-panel" id="register">
        {registration && registrationMode !== "paid" ? <><p className="eyebrow">{registrationMode === "interest" ? "Stay in the loop" : "Free registration"}</p>{registrationsOpen(registration) ? <RegistrationForm eventSlug={slug} mode={registrationMode as "rsvp" | "interest"} maxPartySize={registration.maxPartySize} approvalRequired={Boolean(registration.approvalRequired)} initiallyOpen={query.register === "1"} deadline={registration.closesAt ?? undefined} /> : <p>Registration is closed for this event.</p>}</> : <>
        <div><p className="eyebrow">{salesPending ? "The plan" : "Choose your access"}</p>{salesPending ? <section><div><b>{event.startsAt ? "Admission" : "Tickets coming soon"}</b><span>{event.startsAt ? "The price is set. Ticket sales open soon." : "Keep the outfit ready. We’ll sort the date."}</span></div>{event.startsAt ? <strong>{formatGhanaCedis(event.priceFromMinor)}</strong> : null}</section> : event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => <section key={tier.id}><div><b>{tier.name}</b><span>{tier.description}{tier.status === "available" && tier.remainingAdmissions <= Math.max(5, Math.ceil(tier.capacityAdmissions * 0.1)) ? ` · Only ${tier.remainingAdmissions} left` : ""}</span>{tier.roomBadge === "VIP" ? <small className="tier-vip-note"><Gem size={11} /> VIP identity in The Room · private Host concierge when enabled</small> : null}</div><strong>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</strong></section>)}</div>
        {salesPending ? <p className="event-state-notice">Ticket sales open soon.</p> : event.eventState === "cancelled" ? <p className="event-state-notice">This event has been cancelled. Existing customers will receive refund instructions.</p> : event.eventState === "postponed" ? <p className="event-state-notice">This event has been postponed. A new date will be published after confirmation.</p> : registration && !registrationsOpen(registration) ? <p className="event-state-notice">Registration is closed for this event.</p> : available ? <ActionLink href={`/checkout/${slug}${promoterCode ? `?ref=${encodeURIComponent(promoterCode)}` : ""}`} className="checkout-link" icon={<Ticket size={18} />}>Get tickets</ActionLink> : <span className="checkout-link checkout-link--disabled">Tickets are not currently available</span>}
        {!salesPending ? <p className="secure-note"><ShieldCheck size={14} /> Secure checkout</p> : null}
        <div className="ticket-unlocks"><MessageCircle size={17} /><span><b>Your ticket unlocks the night</b>My Nights, Before the Night, updates, The Room and Flashes.</span></div>
        <MemberActions eventSlug={event.slug} hostSlug={host?.slug} />
        <WaitlistControl eventSlug={event.slug} tiers={event.ticketTiers} />
        </>}
      </aside>
    </div>
  </main>;
}
