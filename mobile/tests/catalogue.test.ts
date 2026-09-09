import assert from 'node:assert/strict';
import test from 'node:test';
import { eventImage, parseCatalogue, readCatalogue, saveCatalogue, ticketLabel } from '../src/catalogue.ts';
import { customerUrl, routeFromUrl } from '../src/routes.ts';
import type { PublicEvent } from '../../lib/public-event.ts';

const event: PublicEvent = { slug: 'test-event', title: 'A real title', image: '/events/test.jpeg', venue: 'Venue', area: 'Accra', vibe: 'Day party', fullDate: 'Coming soon', time: 'To be announced', startsAt: null, scheduleStatus: 'coming_soon', isVerified: true, eventState: 'on_sale', priceFromMinor: 35000, ticketsAvailable: false, colourScheme: 'blush', dressCode: null, guestPerk: null, awarenessNote: null, lineup: '', ageRestriction: '18+', note: '', quip: '' };
const catalogue = { version: 1 as const, updatedAt: '2026-09-09T00:00:00Z', events: [event] };

test('catalogue rejects malformed data and duplicate destinations', () => {
  assert.deepEqual(parseCatalogue(catalogue), catalogue);
  for (const value of [null, {}, { ...catalogue, version: 2 }, { ...catalogue, events: [event, event] }, { ...catalogue, events: [{ ...event, startsAt: 'tomorrow' }] }, { ...catalogue, events: [{ ...event, priceFromMinor: -1 }] }]) assert.throws(() => parseCatalogue(value));
  assert.equal(eventImage('javascript:alert(1)'), null);
  assert.equal(eventImage('http://insecure.test/a'), null);
  assert.equal(eventImage('/events/a.jpeg'), 'https://tickets.becoreops.com/events/a.jpeg');
});
test('public cache expires and tolerates unavailable or corrupt storage', () => {
  const storage = { getItem: () => JSON.stringify(catalogue) };
  assert.ok(readCatalogue(storage, Date.parse(catalogue.updatedAt)));
  assert.equal(readCatalogue(storage, Date.parse(catalogue.updatedAt) + 8 * 86400000), null);
  assert.equal(readCatalogue({ getItem: () => '{' }), null);
  assert.doesNotThrow(() => saveCatalogue({ setItem: () => { throw new Error('Full'); } }, catalogue));
});
test('pending, cancelled and sold-out events do not promise checkout', () => {
  assert.equal(ticketLabel(event), 'Tickets coming soon');
  assert.equal(ticketLabel({ ...event, eventState: 'cancelled' }), 'Cancelled');
  assert.equal(ticketLabel({ ...event, eventState: 'sold_out' }), 'Sold out');
  assert.match(ticketLabel({ ...event, scheduleStatus: 'end_pending' }), /350.*Sales soon/);
});
test('native entry links accept public intents and reject credentials or staff routes', () => {
  assert.deepEqual(routeFromUrl('becoretickets://event/the-weekend-braai'), { tab: 'drop', slug: 'the-weekend-braai' });
  assert.deepEqual(routeFromUrl('https://tickets.becoreops.com/my-nights'), { tab: 'nights' });
  for (const value of ['https://evil.test/events', 'becoretickets://admin', 'https://tickets.becoreops.com/api/customer/recovery/claim?token=x', 'https://user:password@tickets.becoreops.com/events', 'becoretickets://event/../../admin']) assert.equal(routeFromUrl(value), null);
  assert.equal(customerUrl('/my-nights'), 'https://tickets.becoreops.com/my-nights');
  for (const value of ['//evil.test', '/admin', '/api/customer/session', '/my-nights?token=secret', '/event/%2e%2e/admin']) assert.throws(() => customerUrl(value));
});
