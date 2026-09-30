import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScreenCatalogue } from '../src/screen-catalogue.ts';
import { catalogue } from './fixtures.ts';
import { eventArtworkPath, eventSpecialGuest } from '../../lib/event-guest.ts';

test('shared screens reject mismatched, duplicate, preview and malformed public data', () => {
  assert.equal(parseScreenCatalogue(catalogue).screens[1].event.startsAt, null);
  const first = catalogue.screens![0];
  for (const screens of [undefined, [first], [first, first], [{ ...first, event: { ...first.event, isTestEvent: true } }, catalogue.screens![1]], [{ ...first, event: { ...first.event, venueMapUrl: 'javascript:alert(1)' } }, catalogue.screens![1]]]) {
    assert.throws(() => parseScreenCatalogue({ ...catalogue, screens }));
  }
});
test('the cache projection strips unexpected identity and inventory fields', () => {
  const parsed = parseScreenCatalogue({ ...catalogue, session: 'secret', events: catalogue.events.map(event => ({ ...event, email: 'private@example.com' })), screens: catalogue.screens!.map(screen => ({ ...screen, account: 'private', event: { ...screen.event, capacity: 999, bookingFeeBasisPoints: 300, token: 'private' } })) });
  assert.doesNotMatch(JSON.stringify(parsed), /private@example|secret|capacity|bookingFee|token|account/);
});
test('optional Room eligibility survives projection without breaking older cached screens', () => {
  const old = parseScreenCatalogue(catalogue);
  assert.equal(old.screens[0].registration?.roomAccess, undefined);
  for (const roomAccess of [false, true]) {
    const next = parseScreenCatalogue({ ...catalogue, screens: catalogue.screens!.map(screen => ({ ...screen, registration: { ...screen.registration, roomAccess } })) });
    assert.equal(next.screens[0].registration?.roomAccess, roomAccess);
  }
  assert.throws(() => parseScreenCatalogue({ ...catalogue, screens: catalogue.screens!.map(screen => ({ ...screen, registration: { ...screen.registration, roomAccess: 'yes' } })) }));
});
test('canonical native artwork retains the web portrait and approved special guest treatment', () => {
  const screen = parseScreenCatalogue(catalogue).screens.find(screen => screen.event.slug === 'sun-chasers-labadi')!;
  assert.equal(screen.event.image, 'https://tickets.becoreops.com/events/on-the-guest-list.webp');
  assert.equal(eventArtworkPath(screen.event.image), '/events/on-the-guest-list.webp');
  assert.deepEqual(eventSpecialGuest(screen.event), { name: 'Cuppy', role: 'Special Guest DJ' });
});
