import type { CustomerEvent } from "./customer-screen";

/** Advertise the face value of an available ticket/package. Fees belong to checkout. */
export function discoveryFaceMinor<T extends CustomerEvent>(event: T): number {
  const available = event.ticketTiers.filter((tier) => tier.status === "available");
  return available.length ? Math.min(...available.map((tier) => tier.priceMinor)) : event.priceFromMinor;
}

export function discoveryPrice<T extends CustomerEvent>(event: T): string {
  return new Intl.NumberFormat("en-GH", { maximumFractionDigits: 2 }).format(discoveryFaceMinor(event) / 100);
}

/** Keep featured events and discovery cards aligned with the active booking flow. */
export function discoveryOffer<T extends CustomerEvent>(event: T): { label: string; action: string; href: string } {
  const href = `/event/${event.slug}`;
  if (event.eventState === 'cancelled') return { label: 'Cancelled', action: 'Event details', href };
  if (event.eventState === 'postponed') return { label: 'Postponed', action: 'Event details', href };
  if (event.registrationMode === 'rsvp') return { label: 'RSVP', action: 'RSVP', href: `/rsvp/${event.slug}` };
  if (event.registrationMode === 'interest') return { label: 'Keep me posted', action: 'Keep me posted', href: `/rsvp/${event.slug}` };
  if (event.scheduleStatus === 'coming_soon') return { label: 'Tickets coming soon', action: 'Event details', href };
  if (event.scheduleStatus === 'end_pending') return { label: `GH₵${discoveryPrice(event)} · Sales soon`, action: 'Event details', href };
  if (event.eventState === 'sold_out') return { label: 'Sold out', action: 'Event details', href };
  if (event.ticketTiers.some(tier => tier.status === 'available')) return { label: `From GH₵${discoveryPrice(event)}`, action: 'Get tickets', href: `/checkout/${event.slug}` };
  return { label: event.ticketTiers.some(tier => tier.status === 'upcoming') ? 'Sales soon' : 'Sales closed', action: 'Event details', href };
}
