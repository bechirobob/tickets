import { customerEvent } from "../../../lib/customer-screen";
import EventScreen from "./event-screen";
import { registrationSettings, registrationsOpen } from "../../../lib/registrations";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eventImageUrl } from "../../event-images";
import { findCuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { findPrimaryHost } from "../../../lib/event-experience";

export const dynamic = "force-dynamic";

const origin = "https://tickets.becoreops.com";

type EventPageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; register?: string }> };

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) return { title: "Night not found", robots: { index: false, follow: false } };
  const description = `${event.quip} ${event.fullDate} at ${event.venue}, ${event.area}.${event.dressCode ? ` Dress code: ${event.dressCode}.` : ""}${event.guestPerk ? ` ${event.guestPerk}` : ""}${event.registrationMode === "rsvp" ? " RSVP." : event.registrationMode === "interest" ? " Register for announcements." : event.scheduleStatus === "coming_soon" ? " Tickets coming soon." : ` Tickets from ${formatGhanaCedis(event.priceFromMinor)}.`}`;
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
  if(query.register === "1") redirect(`/rsvp/${encodeURIComponent(slug)}`);
  const promoterCode = query.ref?.trim().toUpperCase().replace(/[^A-Z0-9_-]/gu, "").slice(0, 32) ?? "";
  const { env } = await import("cloudflare:workers");
  const [event, host] = await Promise.all([findCuratedEvent(slug), findPrimaryHost(env.DB, slug)]);
  if (!event) notFound();
  const registration = await registrationSettings(env.DB, slug);
  const registrationMode = registration?.mode ?? "paid";
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
    offers: registrationMode === 'interest' ? undefined : registrationMode === 'rsvp' ? [{ '@type': 'Offer', name: 'RSVP', price: '0', priceCurrency: 'GHS', url: `${origin}/event/${event.slug}` }] : event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => ({
      "@type": "Offer",
      name: tier.name,
      price: (tier.priceMinor / 100).toFixed(2),
      priceCurrency: "GHS",
      url: `${origin}/checkout/${event.slug}?tier=${encodeURIComponent(tier.id)}`,
      availability: tier.status === "available" ? "https://schema.org/InStock" : tier.status === "sold_out" ? "https://schema.org/SoldOut" : "https://schema.org/PreOrder",
      validFrom: event.salesOpenAt ?? undefined,
    })),
  };

  return <>
    {structuredEvent ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredEvent).replace(/</gu, "\\u003c") }} /> : null}
    <EventScreen event={customerEvent(event)} host={host} registration={registration ? { mode: registration.mode, open: registrationsOpen(registration), maxPartySize: registration.maxPartySize, approvalRequired: Boolean(registration.approvalRequired), deadline: registration.closesAt ?? null } : null} promoterCode={promoterCode} />
  </>;
}
