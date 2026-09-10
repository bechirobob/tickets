import type { CustomerEventScreen, CustomerEvent } from '../../lib/customer-screen';
import type { PublicCatalogue } from '../../lib/public-event';
import { parseCatalogue } from './catalogue.ts';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid screen');
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 10000) throw new Error('Invalid text');
  return value;
}
function nullable(value: unknown): string | null { return value == null ? null : text(value); }
function date(value: unknown): string | null {
  const result = nullable(value);
  if (result !== null && !Number.isFinite(Date.parse(result))) throw new Error('Invalid date');
  return result;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid number');
  return value;
}
function integer(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid integer');
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid flag');
  return value;
}
function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('Invalid option');
  return value as T;
}
function slug(value: unknown): string {
  const result = text(value);
  if (!/^[a-z0-9-]{1,80}$/.test(result)) throw new Error('Invalid slug');
  return result;
}
function https(value: unknown): string | null {
  const result = nullable(value);
  if (result !== null) {
    const url = new URL(result);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid destination');
  }
  return result;
}
function event(value: unknown): CustomerEvent {
  const e = record(value);
  if (!Array.isArray(e.ticketTiers) || e.ticketTiers.length > 100 || e.isTestEvent !== false) throw new Error('Invalid public event');
  return {
    slug: slug(e.slug), title: text(e.title), image: text(e.image), venue: text(e.venue), venueMapUrl: https(e.venueMapUrl), area: text(e.area),
    shortDate: text(e.shortDate), fullDate: text(e.fullDate), day: text(e.day), time: text(e.time), startsAt: date(e.startsAt), endsAt: date(e.endsAt),
    scheduleStatus: choice(e.scheduleStatus, ['confirmed', 'coming_soon', 'end_pending']),
    vibe: choice(e.vibe, ['Late night', 'Day party', 'Alté', 'Amapiano']),
    eventState: choice(e.eventState, ['on_sale', 'sold_out', 'cancelled', 'postponed', 'rescheduled']),
    registrationMode: choice(e.registrationMode ?? 'paid', ['paid', 'rsvp', 'interest']),
    isVerified: boolean(e.isVerified), isTestEvent: false,
    priceFromMinor: integer(e.priceFromMinor),
    colourScheme: nullable(e.colourScheme), dressCode: nullable(e.dressCode), guestPerk: nullable(e.guestPerk), awarenessNote: nullable(e.awarenessNote),
    lineup: text(e.lineup), ageRestriction: text(e.ageRestriction), note: text(e.note), quip: text(e.quip), sequence: text(e.sequence),
    rescheduledFrom: date(e.rescheduledFrom), salesOpenAt: date(e.salesOpenAt), salesCloseAt: date(e.salesCloseAt),
    ticketTiers: e.ticketTiers.map(value => {
      const tier = record(value);
      return {
        id: text(tier.id), recordId: text(tier.recordId), name: text(tier.name), description: text(tier.description),
        priceMinor: integer(tier.priceMinor), scarcityLabel: tier.scarcityLabel === undefined ? undefined : text(tier.scarcityLabel),
        status: choice(tier.status, ['available', 'sold_out', 'hidden', 'upcoming', 'closed']), roomBadge: tier.roomBadge === null ? null : choice(tier.roomBadge, ['VIP']),
      };
    }),
  };
}
/** Project the allowlist before caching, so unexpected response fields never persist. */
export function parseScreenCatalogue(value: unknown): PublicCatalogue & { screens: CustomerEventScreen[] } {
  const data = parseCatalogue(value);
  if (!Array.isArray(data.screens) || data.screens.length !== data.events.length) throw new Error('Shared screens unavailable');
  const seen = new Set<string>();
  const screens = data.screens.map(value => {
    const s = record(value), e = event(s.event);
    if (seen.has(e.slug) || !data.events.some(item => item.slug === e.slug && item.title === e.title)) throw new Error('Inconsistent catalogue');
    seen.add(e.slug);
    const h = s.host === null ? null : record(s.host);
    const r = s.registration === null ? null : record(s.registration);
    return {
      event: e,
      host: h ? { slug: slug(h.slug), name: text(h.name), role: text(h.role), city: text(h.city), verificationStatus: text(h.verificationStatus) } : null,
      registration: r ? { mode: choice(r.mode, ['paid', 'rsvp', 'interest']), open: boolean(r.open), maxPartySize: integer(r.maxPartySize), approvalRequired: boolean(r.approvalRequired), deadline: date(r.deadline) } : null,
    };
  });
  // The legacy field remains for older signed clients. Only the screens above
  // are used by this build; don't cache arbitrary fields from that old projection.
  return { version: 1, events: data.events.map(e => ({ slug: e.slug, title: e.title, image: e.image, venue: e.venue, area: e.area, vibe: e.vibe, fullDate: e.fullDate, time: e.time, startsAt: e.startsAt, scheduleStatus: e.scheduleStatus, isVerified: e.isVerified, eventState: e.eventState, priceFromMinor: e.priceFromMinor, ticketsAvailable: e.ticketsAvailable, registrationMode: e.registrationMode, registrationOpen: e.registrationOpen, colourScheme: e.colourScheme, dressCode: e.dressCode, guestPerk: e.guestPerk, awarenessNote: e.awarenessNote, lineup: e.lineup, ageRestriction: e.ageRestriction, note: e.note, quip: e.quip })), screens, updatedAt: data.updatedAt };
}
