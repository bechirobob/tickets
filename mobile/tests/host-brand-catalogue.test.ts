import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScreenCatalogue } from '../src/screen-catalogue.ts';
import { catalogue } from './fixtures.ts';

const publicYorke = {
  slug: 'kofi-bills', name: 'Kofi Bills', role: 'Co-host', city: 'Accra', verificationStatus: 'verified',
  profileImageUrl: '/hosts/kofi-bills.webp', brandName: 'The Yorke Way', brandLogoUrl: '/hosts/the-yorke-way.svg',
};
const publicHostKeys = ['slug', 'name', 'role', 'city', 'verificationStatus', 'profileImageUrl', 'brandName', 'brandLogoUrl'].sort();

function withHost(host: unknown, hosts?: unknown): unknown {
  return {
    ...catalogue,
    screens: catalogue.screens!.map(screen => ({ ...screen, host, ...(hosts === undefined ? {} : { hosts }) })),
  };
}

test('native brand caching preserves both host projections and canonicalizes separate logo and portrait URLs', () => {
  const parsed = parseScreenCatalogue(withHost(publicYorke, [publicYorke]));
  for (const screen of parsed.screens) {
    assert.deepEqual(screen.host, {
      ...publicYorke, brandLogoUrl: 'https://tickets.becoreops.com/hosts/the-yorke-way.svg',
      profileImageUrl: 'https://tickets.becoreops.com/hosts/kofi-bills.webp',
    });
    assert.deepEqual(screen.hosts, [screen.host]);
  }
});

test('old caches work without branding or a host list, and explicitly empty lists stay empty', () => {
  const legacyHost = { slug: 'legacy-host', name: 'Legacy Host', role: 'Host', city: 'Accra', verificationStatus: 'reviewed' };
  const legacy = parseScreenCatalogue(withHost(legacyHost));
  assert.deepEqual(legacy.screens[0].host, { ...legacyHost, profileImageUrl: null, brandName: null, brandLogoUrl: null });
  assert.equal(legacy.screens[0].hosts, undefined);
  const noHost = parseScreenCatalogue(withHost(null, []));
  assert.equal(noHost.screens[0].host, null);
  assert.deepEqual(noHost.screens[0].hosts, []);
});

test('native caching strips unexpected host data from the primary and co-host projections', () => {
  const host = { ...publicYorke, id: 'private-host-id', email: 'private@example.com', bio: 'private biography', token: 'private-token' };
  const screen = parseScreenCatalogue(withHost(host, [host])).screens[0];
  assert.deepEqual(Object.keys(screen.host!).sort(), publicHostKeys);
  assert.deepEqual(Object.keys(screen.hosts![0]).sort(), publicHostKeys);
  assert.doesNotMatch(JSON.stringify(screen), /private/);
});

for (const brandLogoUrl of ['javascript:alert(1)', 'http://example.com/logo.svg', 'https://user:secret@example.com/logo.svg']) {
  test(`native caching rejects unsafe brand logo ${brandLogoUrl} in either host projection`, () => {
    assert.throws(() => parseScreenCatalogue(withHost({ ...publicYorke, brandLogoUrl })));
    assert.throws(() => parseScreenCatalogue(withHost(publicYorke, [{ ...publicYorke, brandLogoUrl }])));
  });
}

test('native caching rejects malformed or oversized host lists and non-text brand names', () => {
  for (const hosts of [null, {}, 'not-a-list', Array.from({ length: 101 }, () => publicYorke), [null]]) {
    assert.throws(() => parseScreenCatalogue(withHost(publicYorke, hosts)));
  }
  for (const brandName of [42, {}, ['The Yorke Way']]) {
    assert.throws(() => parseScreenCatalogue(withHost({ ...publicYorke, brandName })));
    assert.throws(() => parseScreenCatalogue(withHost(publicYorke, [{ ...publicYorke, brandName }])));
  }
});
