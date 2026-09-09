import { getPublicEvents } from '../../../events';
import type { PublicCatalogue, PublicEvent } from '../../../../lib/public-event';

// Public, read-only data only. Customer/session endpoints keep their existing
// same-origin protections; this does not enable credentialed cross-origin access.
const headers = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30', 'x-content-type-options': 'nosniff' };

export async function GET() {
  try {
    const records = await getPublicEvents({ throwOnError: true });
    const events: PublicEvent[] = records.filter(event => !event.isTestEvent).map(event => ({
      slug: event.slug, title: event.title, image: event.image, venue: event.venue,
      area: event.area, vibe: event.vibe, fullDate: event.fullDate, time: event.time,
      startsAt: event.startsAt, scheduleStatus: event.scheduleStatus ?? 'confirmed',
      isVerified: event.isVerified === true, eventState: event.eventState,
      priceFromMinor: event.priceFromMinor,
      ticketsAvailable: event.eventState !== 'cancelled' && event.eventState !== 'postponed'
        && event.ticketTiers.some(tier => tier.status === 'available'),
      colourScheme: event.colourScheme ?? null, dressCode: event.dressCode ?? null,
      guestPerk: event.guestPerk ?? null, awarenessNote: event.awarenessNote ?? null,
      lineup: event.lineup, ageRestriction: event.ageRestriction, note: event.note, quip: event.quip,
    }));
    return Response.json({ version: 1, events, updatedAt: new Date().toISOString() } satisfies PublicCatalogue, { headers });
  } catch {
    return Response.json({ error: 'The Drop is taking a breather. Try again shortly.' }, {
      status: 503, headers: { ...headers, 'cache-control': 'no-store', 'retry-after': '30' },
    });
  }
}
