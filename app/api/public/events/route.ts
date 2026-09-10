import { findPrimaryHost } from "../../../../lib/event-experience";
import { customerEvent, type CustomerEventScreen } from "../../../../lib/customer-screen";
import { registrationSettings, registrationsOpen } from '../../../../lib/registrations';
import { getPublicEvents } from '../../../events';
import type { PublicCatalogue, PublicEvent } from '../../../../lib/public-event';

// Public, read-only data only. Customer/session endpoints keep their existing
// same-origin protections; this does not enable credentialed cross-origin access.
const headers = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30', 'x-content-type-options': 'nosniff' };

export async function GET() {
  try {
    const records = await getPublicEvents({ throwOnError: true });
    const { env } = await import('cloudflare:workers');
    const settings = new Map(await Promise.all(records.map(async event => [event.slug, await registrationSettings(env.DB, event.slug)] as const)));
    const events: PublicEvent[] = records.filter(event => !event.isTestEvent).map(event => ({
      slug: event.slug, title: event.title, image: event.image, venue: event.venue,
      area: event.area, vibe: event.vibe, fullDate: event.fullDate, time: event.time,
      startsAt: event.startsAt, scheduleStatus: event.scheduleStatus ?? 'confirmed',
      isVerified: event.isVerified === true, eventState: event.eventState,
      priceFromMinor: settings.get(event.slug)?.mode === 'rsvp' ? 0 : event.priceFromMinor,
      registrationMode: settings.get(event.slug)?.mode ?? 'paid',
      registrationOpen: Boolean(settings.get(event.slug) && registrationsOpen(settings.get(event.slug)!) && settings.get(event.slug)?.mode !== 'paid'),
      ticketsAvailable: settings.get(event.slug)?.mode === 'paid' && event.eventState !== 'cancelled' && event.eventState !== 'postponed'
        && event.ticketTiers.some(tier => tier.status === 'available'),
      colourScheme: event.colourScheme ?? null, dressCode: event.dressCode ?? null,
      guestPerk: event.guestPerk ?? null, awarenessNote: event.awarenessNote ?? null,
      lineup: event.lineup, ageRestriction: event.ageRestriction, note: event.note, quip: event.quip,
    }));
    const screens: CustomerEventScreen[] = await Promise.all(records.filter(event => !event.isTestEvent).map(async event => {
      const host = await findPrimaryHost(env.DB, event.slug);
      const registration = settings.get(event.slug);
      return {
        event: customerEvent(event),
        host: host ? { slug: host.slug, name: host.name, role: host.role, city: host.city, verificationStatus: host.verificationStatus } : null,
        registration: registration ? { mode: registration.mode, open: registrationsOpen(registration), maxPartySize: registration.maxPartySize, approvalRequired: Boolean(registration.approvalRequired), deadline: registration.closesAt ?? null } : null,
      };
    }));
    return Response.json({ version: 1, events, screens, updatedAt: new Date().toISOString() } satisfies PublicCatalogue, { headers });
  } catch {
    return Response.json({ error: 'The Drop is taking a breather. Try again shortly.' }, {
      status: 503, headers: { ...headers, 'cache-control': 'no-store', 'retry-after': '30' },
    });
  }
}
