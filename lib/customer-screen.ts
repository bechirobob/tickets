import type { TicketTier } from "./ticket-tiers";

export type EventState = "on_sale" | "sold_out" | "cancelled" | "postponed" | "rescheduled";

export type CuratedEvent = {
  registrationMode?: 'paid' | 'rsvp' | 'interest';
  slug: string;
  title: string;
  shortDate: string;
  fullDate: string;
  day: string;
  time: string;
  startsAt: string | null;
  endsAt: string | null;
  scheduleStatus?: "confirmed" | "coming_soon" | "end_pending";
  isVerified?: boolean;
  venue: string;
  venueMapUrl: string | null;
  area: string;
  vibe: "Late night" | "Day party" | "Alté" | "Amapiano";
  price: number;
  priceFromMinor: number;
  bookingFeeBasisPoints: number;
  capacity: number;
  ageRestriction: string;
  lineup: string;
  eventState: EventState;
  isTestEvent: boolean;
  dressCode?: string | null;
  colourScheme?: string | null;
  awarenessNote?: string | null;
  guestPerk?: string | null;
  rescheduledFrom: string | null;
  salesOpenAt: string | null;
  salesCloseAt: string | null;
  ticketTiers: TicketTier[];
  image: string;
  note: string;
  quip: string;
  sequence: string;
};

/** Only fields rendered on the public website; never account or host contact data. */
export type CustomerEventScreen = {
  event: CustomerEvent;
  host: { slug: string; name: string; role: string; city: string; verificationStatus: string } | null;
  registration: { mode: 'paid' | 'rsvp' | 'interest'; open: boolean; maxPartySize: number; approvalRequired: boolean; deadline: string | null } | null;
};

export type CustomerEvent = Omit<CuratedEvent, 'price' | 'bookingFeeBasisPoints' | 'capacity' | 'ticketTiers'> & {
  ticketTiers: Array<Pick<TicketTier, 'id' | 'recordId' | 'name' | 'description' | 'priceMinor' | 'status' | 'roomBadge'> & { scarcityLabel?: string }>;
};

/** Public display projection. Raw stock and operational pricing stay server-side. */
export function customerEvent(e: CuratedEvent): CustomerEvent {
  return {
    slug: e.slug, title: e.title, shortDate: e.shortDate, fullDate: e.fullDate, day: e.day, time: e.time,
    startsAt: e.startsAt, endsAt: e.endsAt, scheduleStatus: e.scheduleStatus, isVerified: e.isVerified,
    venue: e.venue, venueMapUrl: e.venueMapUrl, area: e.area, vibe: e.vibe, priceFromMinor: e.priceFromMinor,
    ageRestriction: e.ageRestriction, lineup: e.lineup, eventState: e.eventState, isTestEvent: e.isTestEvent,
    dressCode: e.dressCode, colourScheme: e.colourScheme, awarenessNote: e.awarenessNote, guestPerk: e.guestPerk,
    rescheduledFrom: e.rescheduledFrom, salesOpenAt: e.salesOpenAt, salesCloseAt: e.salesCloseAt,
    image: e.image, note: e.note, quip: e.quip, sequence: e.sequence, registrationMode: e.registrationMode,
    ticketTiers: e.ticketTiers.filter(tier => tier.status !== 'hidden').map(tier => ({
      id: tier.id, recordId: tier.recordId, name: tier.name, description: tier.description,
      priceMinor: tier.priceMinor, status: tier.status, roomBadge: tier.roomBadge,
      scarcityLabel: tier.status === 'available' && tier.remainingAdmissions <= Math.max(5, Math.ceil(tier.capacityAdmissions * 0.1)) ? `Only ${tier.remainingAdmissions} left` : undefined,
    })),
  };
}
