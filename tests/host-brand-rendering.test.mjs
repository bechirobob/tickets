import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requireDependency = createRequire(import.meta.url);
const primary = { slug: 'kofi-bills', name: 'Kofi Bills', role: 'Host', city: 'Accra', verificationStatus: 'verified', profileImageUrl: '/hosts/kofi-bills.webp', brandName: 'The Yorke Way', brandLogoUrl: '/hosts/the-yorke-way.svg' };
const other = { slug: 'another-host', name: 'Another Host', role: 'Co-host', city: 'Kumasi', verificationStatus: 'reviewed', profileImageUrl: null, brandName: 'Another Collective', brandLogoUrl: '/hosts/another-brand.svg' };

const portraitModule = { exports: {} };
const portraitSource = await readFile(new URL('../app/host-portrait.tsx', import.meta.url), 'utf8');
runInNewContext(transformSync(portraitSource, { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code, {
  module: portraitModule, exports: portraitModule.exports,
  require: specifier => specifier.endsWith('.css') ? {} : requireDependency(specifier),
});

async function renderEvent(host, hosts) {
  const source = await readFile(new URL('../app/event/[slug]/event-screen.tsx', import.meta.url), 'utf8');
  const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' });
  const componentModule = { exports: {} };
  const require = specifier => {
    if (specifier === '../../host-portrait') return portraitModule.exports;
    if (specifier === 'next/link') return { __esModule: true, default: ({ children, ...props }) => createElement('a', props, children) };
    if (specifier === 'next/image') return { __esModule: true, default: ({ src, alt, width, height, sizes }) => createElement('img', { src, alt, width, height, sizes }) };
    if (specifier === '../../customer-runtime') return { useCustomerRuntime: () => ({ stale: false }) };
    if (specifier === '../../../lib/event-guest') return { eventArtworkPath: image => image };
    if (specifier === '../../../lib/event-presentation') return { eventColourScheme: () => 'blush', eventPresentationStyle: () => ({}) };
    if (specifier === '../../event-images') return { eventImageUrl: image => image };
    if (specifier === '../../../lib/ticket-tiers') return { formatGhanaCedis: amount => `GHS ${amount / 100}` };
    if (specifier === '../../../lib/registration-guidance') return { registrationOpeningMessage: () => null };
    if (specifier === '../../action') return { ActionLink: ({ children, href }) => createElement('a', { href }, children) };
    if (specifier.startsWith('.')) return { __esModule: true, default: () => null };
    return requireDependency(specifier);
  };
  runInNewContext(compiled.code, { module: componentModule, exports: componentModule.exports, require });
  const event = {
    slug: 'independent-event', title: 'An independently named night', image: '/events/on-the-guest-list.webp',
    venue: 'Original venue', area: 'Accra', vibe: 'Day party', startsAt: null, endsAt: null,
    fullDate: 'Coming soon', scheduleStatus: 'coming_soon', isVerified: true, eventState: 'on_sale',
    isTestEvent: false, ticketTiers: [], note: 'Original organiser copy', lineup: 'Original artist credits',
    ageRestriction: '18+', priceFromMinor: 0,
  };
  return renderToStaticMarkup(createElement(componentModule.exports.default, { event, host, hosts, registration: null }));
}

test('event rendering retains the legacy primary-host contract, portrait and person alongside the brand', async () => {
  const html = await renderEvent(primary);
  assert.match(html, /<h1 id="event-title">An independently named night<\/h1>/);
  assert.match(html, /<h2>Kofi Bills<\/h2>/);
  assert.match(html, /src="\/hosts\/kofi-bills.webp"[^>]*alt="Kofi Bills"|alt="Kofi Bills"[^>]*src="\/hosts\/kofi-bills.webp"/);
  assert.match(html, /class="host-brand-eyebrow">The Yorke Way<\/p>/);
  assert.ok(html.indexOf('The Yorke Way</p>') < html.indexOf('<h2>Kofi Bills</h2>'));
  assert.match(html, /class="host-portrait__seal"><img src="\/hosts\/the-yorke-way.svg"/);
  assert.match(html, /src="\/events\/on-the-guest-list.webp"/);
  assert.match(html, /href="\/hosts\/kofi-bills"/);
  assert.doesNotMatch([...html.matchAll(/<div class="event-host__meta">([\s\S]*?)<\/div>/g)].map(match => match[1]).join(), /Accra/);
  assert.equal((html.match(/<section class="event-host(?: event-host--branded)?"/g) ?? []).length, 1);
});

test('event rendering includes branded secondary hosts and multiple brands without replacing host roles or identity', async () => {
  const html = await renderEvent(other, [other, { ...primary, role: 'Co-host' }]);
  assert.equal((html.match(/<section class="event-host(?: event-host--branded)?"/g) ?? []).length, 2);
  assert.ok(html.indexOf('<h2>Another Host</h2>') < html.indexOf('<h2>Kofi Bills</h2>'));
  assert.match(html, /class="host-brand-eyebrow">Another Collective<\/p>/);
  assert.match(html, /class="host-brand-eyebrow">The Yorke Way<\/p>/);
  assert.ok(html.indexOf('The Yorke Way</p>') < html.indexOf('<h2>Kofi Bills</h2>'));
  assert.match(html, /<span>Co-host<\/span>/);
  assert.doesNotMatch([...html.matchAll(/<div class="event-host__meta">([\s\S]*?)<\/div>/g)].map(match => match[1]).join(), /Accra|Kumasi/);
  assert.match(html, /href="\/hosts\/another-host"/);
  assert.match(html, /href="\/hosts\/kofi-bills"/);
});

test('unbranded, nameless-brand and missing-logo profiles render without empty brand labels or changing portraits', async () => {
  for (const brandName of [undefined, null, '', '   ']) {
    const html = await renderEvent({ ...primary, brandName });
    assert.doesNotMatch(html, /class="host-brand-eyebrow"/);
    assert.match(html, /<h2>Kofi Bills<\/h2>/);
    assert.match(html, /\/hosts\/kofi-bills.webp/);
  }
  const logoMissing = await renderEvent({ ...primary, brandLogoUrl: null });
  assert.match(logoMissing, /class="host-brand-eyebrow">The Yorke Way<\/p>/);
  assert.doesNotMatch(logoMissing, /src="(?:undefined|null|)"/);
});

test('events without host relationships render no host branding, including an explicitly empty current host list', async () => {
  for (const html of [await renderEvent(null), await renderEvent(primary, [])]) {
    assert.doesNotMatch(html, /<section class="event-host(?: event-host--branded)?"|class="host-brand-eyebrow"/);
    assert.match(html, /<h1 id="event-title">An independently named night<\/h1>/);
  }
});

for (const variant of ['profile', 'directory', 'event']) {
  test(`shared ${variant} host portrait preserves the person and approved brand seal`, () => {
    const html = renderToStaticMarkup(createElement(portraitModule.exports.default, { host: primary, variant }));
    assert.match(html, /class="host-portrait__image"[^>]*src="\/hosts\/kofi-bills.webp"/);
    assert.match(html, /class="host-portrait__seal"><img src="\/hosts\/the-yorke-way.svg" alt=""/);
    assert.doesNotMatch(html, /Henry Yorke/);
  });
}
test('shared portrait handles missing brands, logos and portraits without inventing identity', () => {
  for (const host of [{ ...primary, brandName: null }, { ...primary, brandName: ' ' }, { ...primary, brandLogoUrl: null }]) {
    const html = renderToStaticMarkup(createElement(portraitModule.exports.default, { host, variant: 'event' }));
    assert.doesNotMatch(html, /host-portrait__seal/);
    assert.match(html, /kofi-bills.webp/);
  }
  const html = renderToStaticMarkup(createElement(portraitModule.exports.default, { host: { ...primary, profileImageUrl: null }, variant: 'profile' }));
  assert.match(html, /class="host-portrait__initials" role="img" aria-label="Kofi Bills">KB/);
  assert.match(html, /host-portrait__seal/);
  assert.doesNotMatch(html, /src="(?:null|undefined|)"/);
});
