import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { excludeAuditAnalytics } from '../scripts/audit-analytics.mjs';
import { expandEveryVisibleDisclosure } from './e2e/disclosures.mjs';

test('an empty website catalogue renders the real empty state without nonfunctional discovery controls', () => {
  const output = buildSync({ entryPoints: [new URL('../app/event-explorer.tsx', import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/*', 'next/link', 'next/image'] }).outputFiles[0].text;
  const component = { exports: {} };
  runInNewContext(output, { module: component, exports: component.exports, require: createRequire(import.meta.url), process });
  for (const full of [false, true]) {
    const html = renderToStaticMarkup(createElement(component.exports.default, { events: [], full }));
    assert.match(html, /class="event-empty"/u);
    assert.match(html, /The next plan is still cooking\./u);
    assert.match(html, /href="\/organizer\/submit"/u);
    assert.doesNotMatch(html, /drop-card|discovery-search|Pick a date|Next up/u);
  }
});

test('discovery audit derives empty expectations from the website policy, never missing DOM', async () => {
  const source = await readFile(new URL('./e2e/catalogue.ts', import.meta.url), 'utf8');
  const policy = await readFile(new URL('../lib/website-event-listings.ts', import.meta.url), 'utf8');
  const policyModule = { exports: {} };
  runInNewContext(transformSync(policy, { loader: 'ts', format: 'cjs' }).code, { module: policyModule, exports: policyModule.exports });
  const discoveryModule = { exports: {} };
  const discovery = await readFile(new URL('../lib/event-discovery.ts', import.meta.url), 'utf8');
  runInNewContext(transformSync(discovery, { loader: 'ts', format: 'cjs' }).code, { module: discoveryModule, exports: discoveryModule.exports });
  const calls = [];
  const expect = value => new Proxy({}, { get: (_, method) => async argument => { calls.push({ value, method, argument }); } });
  const component = { exports: {} };
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module: component, exports: component.exports,
    require: name => name === './analytics-fixture' ? { expect, test: { extend: () => ({}) } }
      : name === '../../lib/event-discovery' ? discoveryModule.exports : policyModule.exports,
  });
  const locator = value => ({ value, getByRole: (role, options) => locator([value, role, options]) });
  const page = { locator, getByRole: (role, options) => locator([role, options]), getByLabel: locator, evaluate: async () => 0 };
  for (const events of [[], [{ slug: 'sun-chasers-labadi' }], [{ slug: 'the-weekend-braai' }], [{ slug: 'sun-chasers-labadi' }, { slug: 'the-weekend-braai' }]]) {
    calls.length = 0;
    const listed = events.some(policyModule.exports.isWebsiteListedEvent);
    assert.equal(await component.exports.expectWebsiteDiscovery(page, { events }), listed);
    assert.equal(calls.some(call => call.value?.value === '.event-empty'), !listed);
    assert.equal(calls.some(call => call.method === 'toHaveCount' && call.argument === 0), !listed);
    assert.ok(calls.some(call => call.method === 'toBeEnabled'), 'Both states must wait for hydration');
  }
  const now = Date.parse('2026-10-29T12:00:00Z');
  const events = [
    { slug: 'sun-chasers-labadi', startsAt: null, eventState: 'on_sale' },
    { slug: 'past', startsAt: '2026-10-28T12:00:00Z', endsAt: '2026-10-28T16:00:00Z', eventState: 'on_sale' },
    { slug: 'cancelled', startsAt: null, eventState: 'cancelled' },
    { slug: 'postponed', startsAt: null, eventState: 'postponed' },
    { slug: 'upcoming', startsAt: '2026-10-30T12:00:00Z', eventState: 'on_sale' },
    { slug: 'coming-soon', startsAt: null, eventState: 'on_sale' },
  ];
  assert.deepEqual(Array.from(component.exports.nextWebsiteEvents({ screens: events.map(event => ({ event })) }, now), event => event.slug), ['upcoming', 'coming-soon']);
});

test('synthetic camera selection skips external audits before fixture setup and retains every local case', async () => {
  const source = await readFile(new URL('./e2e/flash-camera.spec.ts', import.meta.url), 'utf8');
  const compiled = transformSync(`${source}\nexport { cameraFixture };`, { loader: 'ts', format: 'cjs' }).code;
  for (const externalBaseURL of [undefined, 'https://tickets.becoreops.com', 'https://example.invalid', 'http://127.0.0.1:8788']) {
    for (const event of [undefined, 'pull_request', 'workflow_dispatch']) {
      let skipped = false;
      const cases = [];
      const declare = (title, body) => cases.push({ title, body, skipped });
      declare.skip = condition => { skipped ||= condition; };
      declare.use = () => {};
      declare.info = () => ({ project: { use: { baseURL: externalBaseURL ?? 'http://127.0.0.1:8788' } } });
      const compiledModule = { exports: {} };
      const env = { GITHUB_EVENT_NAME: event };
      if (externalBaseURL !== undefined) env.E2E_BASE_URL = externalBaseURL;
      runInNewContext(compiled, {
        module: compiledModule, exports: compiledModule.exports, process: { env },
        require: id => {
          if (id === './catalogue') return { test: declare };
          if (['@axe-core/playwright', 'node:crypto', 'node:buffer'].includes(id)) return {};
          throw new Error(`Unexpected synthetic camera dependency: ${id}`);
        },
      });
      assert.deepEqual(cases.map(item => item.title), [
        'all cinematic looks preview the exact outgoing blob and preserve consent',
        'rapid look changes, strength zero, comparison and retake remain safe',
        'narrow portrait and rotated landscape keep the saved frame and controls visible',
        'live cinematic looks keep full sensor framing before capture',
      ], 'Retain the original three journeys and the added live-camera journey');
      assert.equal(new Set(cases.map(item => item.title)).size, 4);
      assert.ok(cases.every(item => item.skipped === Boolean(externalBaseURL)), 'Skip must be declared before any case, independent of workflow event');
      if (externalBaseURL?.startsWith('https://')) {
        let pageAccesses = 0;
        const page = new Proxy({}, { get() { pageAccesses++; throw new Error('Fixture touched the page'); } });
        await assert.rejects(compiledModule.exports.cameraFixture(page, 'unused'), /Synthetic camera fixture refuses non-local origins/u);
        assert.equal(pageAccesses, 0, 'The independent fail-closed guard must precede page and network mutation');
      }
    }
  }
});

test('audit analytics routing matches only the exact configured first-party endpoint', async () => {
  for (const origin of ['https://tickets.becoreops.com', 'http://127.0.0.1:8788', 'https://127.0.0.1:8791']) {
    let matcher, handler, removed;
    const context = {
      async route(match, handle) { matcher = match; handler = handle; },
      async unroute(match, handle) { removed = [match, handle]; },
    };
    const remove = await excludeAuditAnalytics(context, origin);
    assert.equal(matcher(new URL('/api/analytics', origin)), true);
    for (const url of [
      new URL('/', origin), new URL('/api/version', origin), new URL('/api/analytics?other=1', origin),
      new URL('/api/analytics/child', origin), new URL('/api/organizer/analytics', origin),
      new URL('https://cloudflareinsights.com/cdn-cgi/rum'), new URL('https://unrelated.example/api/analytics'),
    ]) assert.equal(matcher(url), false, url.href);
    let continued;
    const original = { accept: '*/*', 'content-type': 'application/json', 'x-test-fixture': 'preserve' };
    await handler({ request: () => ({ headers: () => original }), async continue(options) { continued = options; } });
    assert.deepEqual(continued, { headers: { ...original, 'x-becore-analytics': 'exclude' } });
    assert.equal(original['x-becore-analytics'], undefined, 'Do not mutate request headers in place');
    await remove();
    assert.deepEqual(removed, [matcher, handler], 'Remove only the route installed by this helper');
  }
});

function liveDisclosures(rows, { selector = 'details:not([open]) > summary', stuck = false } = {}) {
  const clicked = [];
  const current = () => rows.filter(row => !row.open && row.inScope !== false);
  const page = {
    locator(actual) {
      assert.equal(actual, selector);
      return {
        async all() {
          // Match Playwright's live nth locators: opening one row changes the
          // identity that every saved index resolves to on its next operation.
          return current().map((_, index) => ({
            async isVisible() {
              const row = current()[index];
              return Boolean(row && !row.hidden && (!row.parent || row.parent.open));
            },
            async innerText() { return current()[index].label; },
            async click() {
              const row = current()[index];
              clicked.push(row.label);
              if (!stuck) row.open = true;
            },
          }));
        },
      };
    },
  };
  return { page, clicked };
}

test('disclosure expansion revisits live locators and opens every sibling exactly once', async () => {
  const rows = Array.from({ length: 28 }, (_, index) => ({ label: `Guide ${index + 1}`, open: false }));
  const { page, clicked } = liveDisclosures(rows);
  assert.deepEqual(await expandEveryVisibleDisclosure(page), rows.map(row => row.label));
  assert.deepEqual(clicked, rows.map(row => row.label));
  assert.equal(rows.every(row => row.open), true);
  assert.deepEqual(await expandEveryVisibleDisclosure(page), []);
});

test('disclosure expansion reaches newly visible nested content without reopening open or hidden rows', async () => {
  const parent = { label: 'Parent', open: false };
  const rows = [
    { label: 'Hidden', hidden: true, open: false },
    parent,
    { label: 'Nested', parent, open: false },
    { label: 'Already open', open: true },
    { label: 'Last', open: false },
  ];
  const { page } = liveDisclosures(rows);
  assert.deepEqual(await expandEveryVisibleDisclosure(page), ['Parent', 'Nested', 'Last']);
  assert.equal(rows[0].open, false);
  assert.equal(rows[3].open, true);
});

test('disclosure expansion retains the caller scope and fails if clicks cannot make progress', async () => {
  const selector = '.suite-content details:not([open]) > summary';
  const rows = [{ label: 'Outside', inScope: false }, { label: 'Inside' }];
  const { page } = liveDisclosures(rows, { selector });
  assert.deepEqual(await expandEveryVisibleDisclosure(page, selector), ['Inside']);
  assert.equal(rows[0].open, undefined);
  const stuck = liveDisclosures([{ label: 'Blocked toggle' }], { stuck: true });
  await assert.rejects(expandEveryVisibleDisclosure(stuck.page), /after 150 actions/u);
  assert.equal(stuck.clicked.length, 150);
});

test('maintained browser harnesses never restore the global header or shifting disclosure loop', async () => {
  const e2e = new URL('./e2e/', import.meta.url);
  for (const name of await readdir(e2e)) {
    if (!name.endsWith('.spec.ts') && name !== 'catalogue.ts') continue;
    const source = await readFile(new URL(name, e2e), 'utf8');
    const imports = source.split('\n').filter(line => /^import\s+(?!type\b)/u.test(line) && /\btest\b/u.test(line));
    for (const line of imports) assert.doesNotMatch(line, /from ['"]@playwright\/test['"]/u, `${name} must retain endpoint-scoped analytics exclusion`);
    assert.doesNotMatch(source, /for\s*\(const summary of await page\.locator\([^\n]*details:not\(\[open\]\)[^\n]*\.all\(\)/u, `${name} must re-resolve closed disclosures after each click`);
  }
  for (const name of ['../playwright.config.ts', '../scripts/capture-iphone-layouts.mjs', '../scripts/iphone-layout-evidence.mjs']) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /x-becore-analytics/u, `${name} must not set exclusion on unrelated requests`);
  }
});

test('bounded synthetic Candidate screenshots capture one pixel per CSS pixel without changing their extent', async () => {
  const selected = {
    'room-natural-entry.spec.ts': {
      'room-natural-entry.png': { target: 'page', fullPage: false },
      'room-natural-complete.png': { target: 'page', fullPage: false },
      'room-reduced-motion.png': { target: 'phone', fullPage: false },
    },
    'operations.spec.ts': {
      'fee-effective-time.png': { target: 'page', fullPage: true },
      'provider-record-action.png': { target: 'page', fullPage: true },
      'dispute-provider-handoff.png': { target: 'page', fullPage: true },
    },
  };
  for (const [file, images] of Object.entries(selected)) {
    const source = await readFile(new URL(`./e2e/${file}`, import.meta.url), 'utf8');
    const captures = [...source.matchAll(/await\s+(page|phone)\.screenshot\(\{([^{}]*)\}\)/gu)];
    for (const [filename, expected] of Object.entries(images)) {
      const matching = captures.filter(([, , options]) =>
        options.includes(`outputPath('${filename}')`) || options.includes(`outputPath("${filename}")`));
      assert.equal(matching.length, 1, `${filename} needs exactly one explicit capture`);
      const [, target, options] = matching[0];
      assert.equal(target, expected.target, `${filename} must preserve its page or element capture`);
      assert.match(options, /\bscale:\s*(['"])css\1/u, `${filename} must avoid device-pixel inflation on high-DPR mobile projects`);
      if (expected.fullPage) assert.match(options, /\bfullPage:\s*true\b/u, `${filename} must retain full-page evidence`);
      else assert.doesNotMatch(options, /\bfullPage:/u, `${filename} must retain its viewport or element extent`);
      assert.doesNotMatch(options, /\b(?:clip|quality|mask|animations):/u, `${filename} must not crop, obscure, recompress, or change the captured animation state`);
    }
  }
});
