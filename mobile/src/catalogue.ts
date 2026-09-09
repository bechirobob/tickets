import type { PublicCatalogue, PublicEvent } from '../../lib/public-event';

export const WEB_ORIGIN = 'https://tickets.becoreops.com';
export const CATALOGUE_URL = `${WEB_ORIGIN}/api/public/events`;
const CACHE_KEY = 'becore.public-catalogue.v1';
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000;

export function eventImage(value: string): string | null {
  try {
    const url = new URL(value, WEB_ORIGIN);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseCatalogue(value: unknown): PublicCatalogue {
  if (!value || typeof value !== 'object') throw new Error('Invalid catalogue');
  const data = value as PublicCatalogue;
  if (data.version !== 1 || !Array.isArray(data.events) || data.events.length > 100
    || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Invalid catalogue');
  const slugs = new Set<string>();
  for (const event of data.events) {
    if (!event || typeof event !== 'object' || !/^[a-z0-9-]{1,80}$/.test(event.slug)
      || slugs.has(event.slug)) throw new Error('Invalid event');
    slugs.add(event.slug);
    const textFields = ['title', 'image', 'venue', 'area', 'vibe', 'fullDate', 'time', 'scheduleStatus', 'eventState', 'lineup', 'ageRestriction', 'note', 'quip'] as const;
    if (textFields.some(key => typeof event[key] !== 'string' || event[key].length > 10000)
      || !event.title.trim() || typeof event.isVerified !== 'boolean' || typeof event.ticketsAvailable !== 'boolean'
      || (event.registrationMode !== undefined && !['paid', 'rsvp', 'interest'].includes(event.registrationMode))
      || (event.registrationOpen !== undefined && typeof event.registrationOpen !== 'boolean')
      || !Number.isSafeInteger(event.priceFromMinor) || event.priceFromMinor < 0
      || (event.startsAt !== null && (typeof event.startsAt !== 'string' || !Number.isFinite(Date.parse(event.startsAt))))
      || ['colourScheme', 'dressCode', 'guestPerk', 'awarenessNote'].some(key => {
        const field = event[key as keyof PublicEvent];
        return field !== null && (typeof field !== 'string' || field.length > 10000);
      })) throw new Error('Invalid event details');
  }
  return data;
}

export function readCatalogue(storage: Pick<Storage, 'getItem'>, now = Date.now()): PublicCatalogue | null {
  try {
    const data = parseCatalogue(JSON.parse(storage.getItem(CACHE_KEY) ?? 'null'));
    const age = now - Date.parse(data.updatedAt);
    return age >= -60000 && age <= MAX_CACHE_AGE ? data : null;
  } catch { return null; }
}

export function saveCatalogue(storage: Pick<Storage, 'setItem'>, data: PublicCatalogue) {
  // Only public event information is cached. No identity, session or entry pass.
  try { storage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* Storage may be unavailable. */ }
}

export function ticketLabel(event: PublicEvent): string {
  if (event.eventState === 'cancelled') return 'Cancelled';
  if (event.eventState === 'postponed') return 'New date on the way';
  if (event.registrationMode === 'rsvp') return 'Free RSVP';
  if (event.registrationMode === 'interest') return event.registrationOpen ? 'Announcements open' : 'Announcements';
  if (event.eventState === 'sold_out') return 'Sold out';
  if (event.scheduleStatus === 'coming_soon') return 'Tickets coming soon';
  const price = event.priceFromMinor ? `GH₵${new Intl.NumberFormat('en-GH', { maximumFractionDigits: 2 }).format(event.priceFromMinor / 100)}` : 'Free entry';
  return event.ticketsAvailable ? price : `${price} · Sales soon`;
}
