"use client";

import EventStory from "./event-story";
import RegistrationForm from "../../registration-form";
import BrandLogo from "../../brand-logo";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowUpRight, BadgeCheck, Gem, MessageCircle, Ribbon, ShieldCheck, Ticket } from "lucide-react";
import { eventImageUrl } from "../../event-images";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { ActionLink } from "../../action";
import EventActions from "./event-actions";
import MemberActions from "../../member-actions";
import WaitlistControl from "./waitlist-control";
import PublicNavigation from "../../mobile-navigation";
import EventCountdown from "./event-countdown";
import EventPerkIcon from "./event-perk-icon";
import { eventColourScheme, eventPresentationStyle } from "../../../lib/event-presentation";
import "./event-details.css";

import { useCustomerRuntime } from "../../customer-runtime";
import type { CustomerEventScreen } from "../../../lib/customer-screen";

export default function EventScreen({ event, host, registration, promoterCode = "" }: CustomerEventScreen & { promoterCode?: string }) {
  const runtime = useCustomerRuntime();
  const slug = event.slug;
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
  return <main className="event-page compact-event-page poster-event-page" data-colour-scheme={colourScheme} style={eventPresentationStyle(event)}>
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
        <EventStory note={event.note} lineup={event.lineup} quip={event.quip} ageRestriction={event.ageRestriction} showEntry={!salesPending}/>
        {host ? <section className="event-host"><div className="host-monogram">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p><BadgeCheck size={13} /> {host.verificationStatus === "verified" ? "Verified Host" : "Reviewed Host"}</p><h2>{host.name}</h2><span>{host.role} · {host.city}</span><Link href={`/hosts/${host.slug}`}>View Host <ArrowUpRight size={14} /></Link></div></section> : null}
      </article>

      <aside className="compact-ticket-panel" id="register" inert={runtime.stale || undefined}>
        {registration && registrationMode !== "paid" ? <><p className="eyebrow">{registrationMode === "interest" ? "Stay in the loop" : "RSVP"}</p>{registration.open ? <RegistrationForm eventSlug={slug} mode={registrationMode as "rsvp" | "interest"} maxPartySize={registration.maxPartySize} approvalRequired={registration.approvalRequired}  deadline={registration.deadline ?? undefined} /> : <p>The guest list is closed for this one.</p>}</> : <>
        <div><p className="eyebrow">{salesPending ? "The plan" : "Choose your access"}</p>{salesPending ? <section><div><b>{event.startsAt ? "Admission" : "Tickets coming soon"}</b><span>{event.startsAt ? "The price is set. Ticket sales open soon." : "Keep the outfit ready. We’ll sort the date."}</span></div>{event.startsAt ? <strong>{formatGhanaCedis(event.priceFromMinor)}</strong> : null}</section> : event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => <section key={tier.id}><div><b>{tier.name}</b><span>{tier.description}{tier.scarcityLabel ? ` · ${tier.scarcityLabel}` : ""}</span>{tier.roomBadge === "VIP" ? <small className="tier-vip-note"><Gem size={11} /> Your VIP badge, plus a private line to the host when concierge is open</small> : null}</div><strong>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</strong></section>)}</div>
        {salesPending ? <p className="event-state-notice">Ticket sales open soon.</p> : event.eventState === "cancelled" ? <p className="event-state-notice">This one’s been called off. Already paid? Check My Nights for refund help.</p> : event.eventState === "postponed" ? <p className="event-state-notice">New date loading. Hold onto your ticket and check back for the host’s update.</p> : registration && !registration.open ? <p className="event-state-notice">The guest list is closed for this one.</p> : available ? <ActionLink href={`/checkout/${slug}${promoterCode ? `?ref=${encodeURIComponent(promoterCode)}` : ""}`} className="checkout-link" icon={<Ticket size={18} />}>Get tickets</ActionLink> : <span className="checkout-link checkout-link--disabled">Tickets are taking a breather</span>}
        {!salesPending ? <p className="secure-note"><ShieldCheck size={14} /> Secure checkout</p> : null}
        <div className="ticket-unlocks"><MessageCircle size={17} /><span><b>Your ticket unlocks the night</b>My Nights, Before the Night, updates, The Room and Flashes.</span></div>
        <MemberActions eventSlug={event.slug} hostSlug={host?.slug} />
        <WaitlistControl eventSlug={event.slug} tiers={event.ticketTiers} />
        </>}
      </aside>
    </div>
  </main>;
}
