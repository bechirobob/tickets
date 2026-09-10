import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScreenCatalogue } from '../src/screen-catalogue.ts';
import { catalogue } from './fixtures.ts';

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
