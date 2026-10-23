import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assessLayoutParity, readDiscoveryEvidence, websiteDiscoveryCatalogue, websiteDiscoveryContract } from '../scripts/iphone-layout-parity.mjs';

const excluded = 'sun-chasers-labadi';
const catalogue = () => ({
  version: 1, updatedAt: '2026-10-23T17:10:08.751Z', extraField: 'preserved',
  events: [
    { slug: 'another-event', title: 'Another night', price: 123 },
    { slug: excluded, title: 'On The Guest List', registrationOpen: true },
    { slug: `${excluded}-later`, title: 'A different event', venue: 'Kempinski' },
  ],
  screens: [
    { event: { slug: 'another-event', title: 'Another night' }, host: { name: 'A host' } },
    { event: { slug: excluded, title: 'On The Guest List' }, registration: { open: true } },
    { event: { slug: `${excluded}-later`, title: 'A different event' }, host: null },
  ],
});
const element = (tag, text) => ({ tag, text, font: 'BeCore Inter', size: '16px', color: 'rgb(244, 241, 234)' });
const hero = text => ({ ...element('SECTION', text), width: '390px', height: '430px', objectFit: 'fill', objectPosition: '50% 50%', portraitCrop: null });
const discoveryCase = (route = '/') => ({
  route,
  app: [hero('On The Guest List'), element('H3', 'Another night'), element('H3', 'On The Guest List'), element('NAV', 'HomeThe DropMy Nights')],
  website: [hero('Another night'), element('H3', 'Another night'), element('NAV', 'HomeThe DropMy Nights')],
  reference: [hero('Another night'), element('H3', 'Another night'), element('NAV', 'HomeThe DropMy Nights')],
  discovery: { cardSlugs: ['another-event'], activeSlug: 'another-event', excludedLinks: [], excludedTitlePresent: false },
  referenceDiscovery: { cardSlugs: ['another-event'], activeSlug: 'another-event', excludedLinks: [], excludedTitlePresent: false },
});

test('the contract has exactly one excluded slug and only two website discovery routes', () => {
  assert.deepEqual(websiteDiscoveryContract, { name: 'website-only-kempinski-discovery-exclusion', slug: excluded, routes: ['/', '/events'] });
});

test('the reference removes only the exact slug, preserving every other record, field, order and the native source', () => {
  const original = catalogue();
  const before = JSON.stringify(original);
  Object.freeze(original);
  Object.freeze(original.events);
  Object.freeze(original.screens);
  for (const record of [...original.events, ...original.screens]) Object.freeze(record);
  const reference = websiteDiscoveryCatalogue(original);
  assert.deepEqual(reference, { ...original, events: [original.events[0], original.events[2]], screens: [original.screens[0], original.screens[2]] });
  assert.equal(reference.events[0], original.events[0]);
  assert.equal(reference.screens[1], original.screens[2]);
  assert.equal(JSON.stringify(original), before);
  assert.ok(original.events.some(event => event.slug === excluded));
  assert.ok(original.screens.some(screen => screen.event.slug === excluded));
});

test('native event removal, missing direct screens, duplicate exclusions and catalogue inconsistencies fail closed', () => {
  for (const mutate of [
    value => { value.events = value.events.filter(event => event.slug !== excluded); },
    value => { value.screens = value.screens.filter(screen => screen.event.slug !== excluded); },
    value => { value.events.push(value.events[1]); value.screens.push(value.screens[1]); },
    value => { value.screens[0].event.slug = 'wrong-event'; },
    value => { value.screens = null; },
  ]) {
    const value = catalogue();
    mutate(value);
    assert.throws(() => websiteDiscoveryCatalogue(value), /Native catalogue must retain/u);
  }
});

test('website discovery uses strict reference equality and records the genuine app difference rather than claiming full parity', () => {
  for (const route of ['/', '/events']) {
    const assessment = assessLayoutParity(discoveryCase(route));
    assert.equal(assessment.match, true);
    assert.equal(assessment.strictMatch, false);
    assert.equal(assessment.excludedEvent, excluded);
    assert.deepEqual(assessment.app, discoveryCase(route).app);
    assert.equal(assessment.contract, websiteDiscoveryContract.name);
  }
});

test('the exact empty discovery fallback also remains fully compared', () => {
  const input = discoveryCase();
  input.reference = input.website = [hero('Plans, sorted.'), element('H1', 'Plans, sorted.'), element('NAV', 'HomeThe DropMy Nights')];
  input.discovery = input.referenceDiscovery = { cardSlugs: [], activeSlug: 'waiting', excludedLinks: [], excludedTitlePresent: false };
  assert.equal(assessLayoutParity(input).match, true);
  input.website = structuredClone(input.website);
  input.website[0].text = 'Wrong fallback';
  assert.equal(assessLayoutParity(input).match, false);
});

test('changes to every measured field, unaffected event text, missing/extra cards and order still fail discovery parity', () => {
  for (const route of ['/', '/events']) {
    for (const field of Object.keys(discoveryCase().website[0])) {
      const input = discoveryCase(route);
      input.website[0][field] = `wrong-${field}`;
      assert.equal(assessLayoutParity(input).match, false, `${route}: ${field}`);
    }
    for (const mutate of [
      input => { input.website[1].text = 'Wrong unaffected event'; },
      input => { input.website.splice(1, 1); },
      input => { input.website.push(element('H3', 'Unexpected event')); },
      input => { input.website.reverse(); },
      input => { input.discovery.cardSlugs = ['wrong-event']; },
      input => { input.discovery.activeSlug = 'wrong-event'; },
      input => { input.reference = undefined; },
      input => { input.referenceDiscovery = undefined; },
      input => { input.app = []; },
      input => { input.website = input.reference = []; },
    ]) {
      const input = discoveryCase(route);
      mutate(input);
      assert.equal(assessLayoutParity(input).match, false);
    }
  }
});

test('reappearing excluded links, title, featured hero or cards fail even when the reference has the same regression', () => {
  for (const mutate of [
    evidence => { evidence.excludedLinks = [`/event/${excluded}`]; },
    evidence => { evidence.excludedLinks = [`/rsvp/${excluded}`]; },
    evidence => { evidence.excludedTitlePresent = true; },
    evidence => { evidence.activeSlug = excluded; },
    evidence => { evidence.cardSlugs.push(excluded); },
    evidence => { evidence.excludedTitlePresent = null; },
  ]) {
    const input = discoveryCase();
    mutate(input.discovery);
    input.referenceDiscovery = structuredClone(input.discovery);
    assert.equal(assessLayoutParity(input).match, false);
  }
});

test('direct event pages, including the excluded event, never receive the discovery exception', () => {
  for (const route of [`/event/${excluded}`, '/event/another-event', '/events/other', '/help']) {
    const input = discoveryCase(route);
    assert.equal(assessLayoutParity(input).match, false, route);
    input.website = structuredClone(input.app);
    assert.equal(assessLayoutParity(input).match, true, route);
    assert.equal(assessLayoutParity(input).contract, 'strict-app-website-parity');
    input.website[0].text = 'Unavailable guest access';
    assert.equal(assessLayoutParity(input).match, false, route);
  }
});

test('discovery evidence checks exact path segments and cards, including hidden links, without hiding prefix-matched events', async t => {
  const previous = globalThis.document;
  const links = [`/event/${excluded}`, `/rsvp/${excluded}?ref=guest`, `/event/${excluded}-later`];
  globalThis.document = {
    querySelectorAll: selector => selector === '.drop-card'
      ? [{ getAttribute: () => excluded }]
      : links.map(path => ({ href: `https://tickets.becoreops.com${path}` })),
    querySelector: selector => selector === 'main'
      ? { textContent: 'Explore On The Guest List' }
      : { getAttribute: () => excluded },
  };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const evidence = await readDiscoveryEvidence({ evaluate: (fn, value) => fn(value) }, 'On The Guest List');
  assert.deepEqual(evidence, {
    cardSlugs: [excluded], activeSlug: excluded,
    excludedLinks: [`/event/${excluded}`, `/rsvp/${excluded}`], excludedTitlePresent: true,
  });
});

test('capture keeps unmodified native app data and all direct routes separate from the discovery-only reference', async () => {
  const capture = await readFile(new URL('../scripts/capture-iphone-layouts.mjs', import.meta.url), 'utf8');
  assert.match(capture, /page\.route\(`\$\{origin\}\/api\/public\/events`, route => route\.fulfill\(\{json:catalogue/u);
  assert.match(capture, /referencePage\.route\(`\$\{origin\}\/api\/public\/events`, route => route\.fulfill\(\{json:discoveryCatalogue/u);
  assert.ok(capture.indexOf("await capture('No events yet'") < capture.indexOf('const referenceContext = await browser.newContext(device)'));
  assert.match(capture, /for \(const route of websiteDiscoveryContract.routes\)/u);
  assert.match(capture, /JSON.stringify\(catalogue\) !== originalCatalogue/u);
  assert.match(capture, /catalogue.events.map\(event => \[event.title, '\/event\/' \+ event.slug\]\)/u);
  assert.match(capture, /catalogue.events.map\(event=>\[event.title\+' website', '\/event\/'\+event.slug\]\)/u);
  assert.match(capture, /if \(!assessment.match\) throw new Error/u);
  assert.match(capture, /await routeNativeArtwork\(page\)/u);
  assert.match(capture, /await routeNativeArtwork\(referencePage\)/u);
  const repositoryTests = await readFile(new URL('./repository-boundaries.test.mjs', import.meta.url), 'utf8');
  assert.match(repositoryTests, /import '\.\/iphone-layout-parity.test.mjs'/u);
});
