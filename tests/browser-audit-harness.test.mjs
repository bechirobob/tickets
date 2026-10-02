import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { excludeAuditAnalytics } from '../scripts/audit-analytics.mjs';
import { expandEveryVisibleDisclosure } from './e2e/disclosures.mjs';

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
