import type { PublicCatalogue, PublicEvent } from '../../lib/public-event';
import type { CustomerEventScreen } from '../../lib/customer-screen';
export const braai: PublicEvent = { slug: 'the-weekend-braai', title: 'The Weekend Braai — Birthday Edition', image: '/events/the-weekend-braai.jpeg', venue: 'Number Nineteen', area: 'No. 19 Akosombo Street, Airport Residential Area, Accra', vibe: 'Day party', fullDate: 'Sunday 20 September 2026', time: '14:00 onwards', startsAt: '2026-09-20T14:00:00.000Z', scheduleStatus: 'end_pending', isVerified: true, eventState: 'on_sale', priceFromMinor: 35000, ticketsAvailable: false, registrationMode: 'rsvp', registrationOpen: true, colourScheme: 'sunset', dressCode: null, guestPerk: 'Unlimited grills & drinks', awarenessNote: null, lineup: 'Kofi Billz × Ghadi × Shepherd', ageRestriction: '18+', note: 'Grills, beers, tequila and games.', quip: 'Come hungry. Leave legendary.' };
export const guest: PublicEvent = { ...braai, slug: 'sun-chasers-labadi', title: 'On The Guest List', image: '/events/on-the-guest-list.webp', venue: 'Asana Restaurant', area: 'Kempinski Gold Coast Hotel, Accra', colourScheme: 'blush', startsAt: null, fullDate: 'Coming soon', scheduleStatus: 'coming_soon', registrationMode: 'interest', dressCode: 'Light pink & white', guestPerk: 'Free mimosas till 5pm', quip: 'Your name looks good here.', lineup: 'Kofi Billz', note: 'Good music, familiar faces and a little pink for a cause close to many hearts.' };
function screen(e: PublicEvent): CustomerEventScreen {
  return { event: {
    ...e, image: `https://tickets.becoreops.com${e.image}`, scheduleStatus: e.scheduleStatus as 'coming_soon' | 'end_pending', eventState: 'on_sale', vibe: 'Day party',
    shortDate: e.startsAt ? '20 SEPT' : 'Coming soon', day: e.startsAt ? 'Sunday' : '', endsAt: null, venueMapUrl: null, isTestEvent: false,
    rescheduledFrom: null, salesOpenAt: null, salesCloseAt: null, sequence: '01', ticketTiers: [],
  }, host: null, registration: { mode: e.registrationMode!, open: true, maxPartySize: 4, approvalRequired: false, deadline: null } };
}
export const catalogue: PublicCatalogue = { version: 1, updatedAt: '2026-09-10T12:00:00.000Z', events: [braai, guest], screens: [screen(braai), screen(guest)] };
