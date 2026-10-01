import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assessMenuGeometry, captureWebsiteComparison, isInsideViewport, isReadOnlyRequest, readReleaseEvidence, verifyReleaseIdentity } from '../scripts/iphone-layout-evidence.mjs';

const revision = '45ec44e35f8b0e5099a328ce219df2529374f9ee';
const version = { service: 'becore-tickets', revision };
const health = { ...version, runtime: 'vps', active: true };

const viewport = { width: 390, height: 664 };
const visibleElement = bounds => ({ bounds, visible: true, inert: false, ariaHidden: 'false' });
const menuGeometry = () => ({
  viewport, customerDockPresent: true,
  panel: visibleElement({ x: 0, y: 284, width: 390, height: 380 }),
  close: visibleElement({ x: 330, y: 292, width: 44, height: 44 }),
  controls: ['/hosts', '/organizer/submit', '/about', '/help'].map((href, index) => ({
    ...visibleElement({ x: 16, y: 352 + index * 60, width: 300, height: 52 }), tag: 'A', href,
  })),
  ancestors: [{ visible: true, inert: false, ariaHidden: null }],
});

test('menu geometry accepts positive bounds fully inside the viewport, including exact edges', () => {
  assert.equal(isInsideViewport({ x: 0, y: 0, ...viewport }, viewport), true);
  assert.deepEqual(assessMenuGeometry(menuGeometry()), { passed: true, problems: [] });
});

const hiddenDockDuplicate = href => ({
  ...visibleElement({ x: 0, y: 0, width: 0, height: 0 }), visible: false,
  tag: 'A', href, className: 'menu-primary-route', computed: { display: 'none' },
});

test('menu geometry records but excludes only intentional CSS-hidden mobile dock duplicates', () => {
  const geometry = menuGeometry();
  geometry.controls.push(...['/', '/events', '/my-nights'].map(hiddenDockDuplicate));
  const assessment = assessMenuGeometry(geometry);
  assert.equal(assessment.passed, true);
  assert.deepEqual(assessment.excludedControls.map(control => control.href), ['/', '/events', '/my-nights']);
  assert.equal(geometry.controls.length, 7);
});

test('menu geometry requires every secondary destination to exist and remain visible even with a primary-route class', () => {
  for (const href of ['/hosts', '/organizer/submit', '/about', '/help']) {
    const missing = menuGeometry();
    missing.controls = missing.controls.filter(control => control.href !== href);
    assert.equal(assessMenuGeometry(missing).passed, false);
    const hidden = menuGeometry();
    hidden.controls = hidden.controls.map(control => control.href === href ? hiddenDockDuplicate(href) : control);
    assert.equal(assessMenuGeometry(hidden).passed, false);
  }
});

test('menu geometry does not forgive arbitrary hidden controls or mismatched duplicate conditions', () => {
  const mutations = [
    geometry => { geometry.controls.push(hiddenDockDuplicate('/unexpected')); },
    geometry => { geometry.controls.push({ ...hiddenDockDuplicate('/'), className: '' }); },
    geometry => { geometry.controls.push({ ...hiddenDockDuplicate('/'), computed: { display: 'block' } }); },
    geometry => { geometry.controls.push(hiddenDockDuplicate('/')); geometry.customerDockPresent = false; },
    geometry => { geometry.controls.push(hiddenDockDuplicate('/')); geometry.viewport = { width: 701, height: 664 }; },
  ];
  for (const mutate of mutations) {
    const geometry = menuGeometry();
    mutate(geometry);
    assert.equal(assessMenuGeometry(geometry).passed, false);
  }
});

test('menu geometry rejects controls hidden by an intermediate links container', () => {
  const geometry = menuGeometry();
  geometry.controls[0].visibilityAncestors = [{ className: 'night-mobile-menu__links', opacity: '0', visible: false }];
  assert.equal(assessMenuGeometry(geometry).passed, false);
  assert.match(assessMenuGeometry(geometry).problems.join(' '), /hidden or inert ancestor inside the panel/u);
});

test('menu geometry rejects offscreen, partly clipped, empty and non-finite rectangles', () => {
  for (const bounds of [
    { x: 390, y: 284, width: 390, height: 380 },
    { x: -1, y: 284, width: 390, height: 380 },
    { x: 0, y: 285, width: 390, height: 380 },
    { x: 0, y: -1, width: 390, height: 380 },
    { x: 0, y: 284, width: 0, height: 380 },
    { x: 0, y: 284, width: 390, height: 0 },
    { x: Number.NaN, y: 284, width: 390, height: 380 },
    { x: 0, y: 284, width: Infinity, height: 380 },
    null,
  ]) {
    assert.equal(isInsideViewport(bounds, viewport), false);
    const geometry = menuGeometry();
    geometry.panel.bounds = bounds;
    assert.equal(assessMenuGeometry(geometry).passed, false);
  }
});

test('menu geometry rejects an offscreen close button or navigation control inside an otherwise valid panel', () => {
  for (const target of ['close', 'control']) {
    const geometry = menuGeometry();
    (target === 'close' ? geometry.close : geometry.controls[0]).bounds.x = 390;
    assert.equal(assessMenuGeometry(geometry).passed, false);
  }
});

test('menu geometry rejects hidden, inert, missing controls and invisible ancestors despite valid bounds', () => {
  const mutations = [
    geometry => { geometry.panel.visible = false; },
    geometry => { geometry.panel.ariaHidden = 'true'; },
    geometry => { geometry.close.inert = true; },
    geometry => { geometry.controls[0].visible = false; },
    geometry => { geometry.controls = []; },
    geometry => { geometry.ancestors[0].visible = false; },
    geometry => { geometry.ancestors[0].inert = true; },
    geometry => { geometry.close = null; },
  ];
  for (const mutate of mutations) {
    const geometry = menuGeometry();
    mutate(geometry);
    assert.equal(assessMenuGeometry(geometry).passed, false);
  }
});

test('a failed menu capture saves measured layout facts before its diagnostic screenshot and failure', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tickets-menu-evidence-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(url.pathname === '/healthz' ? health : version), { status: 200 }));
  const geometry = menuGeometry();
  geometry.panel.bounds.x = 390;
  geometry.ancestors[0].computed = { justifySelf: 'end', width: '0px' };
  const manifestPath = path.join(directory, 'website-comparison', 'comparison.json');
  let currentUrl;
  let savedBeforeScreenshot = false;
  const locator = { first() { return this; }, waitFor: async () => {}, click: async () => {} };
  const page = {
    goto: async url => { currentUrl = url; return { ok: () => true }; },
    locator: () => locator, getByRole: () => locator,
    url: () => currentUrl, viewportSize: () => viewport, waitForTimeout: async () => {},
    evaluate: async (fn, screenshotViewport) => {
      if (fn.toString().includes('const panel = document.querySelector')) {
        assert.deepEqual(screenshotViewport, viewport);
        return geometry;
      }
      return false;
    },
    screenshot: async options => {
      if (options.path.endsWith('before-menu.png')) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        assert.equal(manifest.menuChecks[0].assessment.passed, false);
        assert.deepEqual(manifest.menuChecks[0].geometry.ancestors[0].computed, { justifySelf: 'end', width: '0px' });
        savedBeforeScreenshot = true;
      }
    },
  };
  const context = { route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page, close: async () => {} };
  await assert.rejects(captureWebsiteComparison({
    browser: { newContext: async () => context }, device: { viewport }, outputDir: directory,
    repo: directory, candidateOrigin: 'http://127.0.0.1:8788', sourceRevision: revision,
  }), /before menu geometry failed/u);
  assert.equal(savedBeforeScreenshot, true);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.menuChecks[0].geometry.panel.bounds.x, 390);
  assert.equal(manifest.screenshots.at(-1).filename, 'before-menu.png');
});

test('metadata reads require HTTP 200 on both version and health, even for valid-looking JSON', async t => {
  let rejectedPath = '/api/version';
  let status = 201;
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(url.pathname === '/healthz' ? health : version), {
    status: url.pathname === rejectedPath ? status : 200,
  }));
  for (rejectedPath of ['/api/version', '/healthz']) {
    for (status of [201, 202, 206, 301, 400, 404, 500]) {
      await assert.rejects(readReleaseEvidence('https://tickets.becoreops.com', { production: true }), /requires HTTP 200/u);
    }
  }
});

test('metadata reads retain redirect rejection and accept a complete body at the 64 KiB boundary', async t => {
  const json = JSON.stringify(version);
  const body = json + ' '.repeat(64 * 1024 - Buffer.byteLength(json));
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return new Response(body, { status: 200 });
  });
  assert.equal((await readReleaseEvidence('https://tickets.becoreops.com')).revision, revision);
});

test('metadata reads reject oversized UTF-8 bodies without relying on content-length', async t => {
  const body = JSON.stringify({ ...version, padding: 'é'.repeat(32 * 1024) });
  assert.ok(body.length < 64 * 1024);
  assert.ok(Buffer.byteLength(body) > 64 * 1024);
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
  await assert.rejects(readReleaseEvidence('https://tickets.becoreops.com'), /exceeds 64 KiB/u);
});

test('metadata reads enforce the cumulative stream limit and cancel an oversized body', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(version)));
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() { cancelled = true; },
  }), { status: 200 }));
  await assert.rejects(readReleaseEvidence('https://tickets.becoreops.com'), /exceeds 64 KiB/u);
  assert.equal(cancelled, true);
});

test('accepts matching active production health/version and exact source identity', () => {
  assert.equal(verifyReleaseIdentity(version, { health, expectedRevision: revision }), revision);
  assert.equal(verifyReleaseIdentity(version, { expectedRevision: revision }), revision);
});

test('rejects absent, abbreviated and wrong service revision evidence', () => {
  for (const invalid of [null, {}, { ...version, revision: '45ec44e' }, { ...version, service: 'other' }]) {
    assert.throws(() => verifyReleaseIdentity(invalid), /identity/u);
  }
});

test('rejects baseline drift and candidate build/source mismatch', () => {
  assert.throws(() => verifyReleaseIdentity(version, { expectedRevision: 'a'.repeat(40) }), /revision/u);
});

test('rejects inactive, non-VPS and mismatched production health', () => {
  for (const invalid of [{}, { ...health, active: false }, { ...health, runtime: 'worker' }, { ...health, revision: 'b'.repeat(40) }, { ...health, service: 'other' }]) {
    assert.throws(() => verifyReleaseIdentity(version, { health: invalid }), /health/u);
  }
});

test('the screenshot-only request policy permits reads and blocks writes', () => {
  assert.equal(isReadOnlyRequest('GET'), true);
  assert.equal(isReadOnlyRequest('HEAD'), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(isReadOnlyRequest(method), false);
});

test('captures real baseline in isolated contexts before existing native fixtures', async () => {
  const [capture, helper] = await Promise.all([
    readFile(new URL('../scripts/capture-iphone-layouts.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/iphone-layout-evidence.mjs', import.meta.url), 'utf8'),
  ]);
  assert.ok(capture.indexOf('await captureWebsiteComparison(') < capture.indexOf('await page.route('));
  assert.match(capture, /expectedBaselineRevision:process.env.LAYOUT_BASELINE_SHA/u);
  assert.match(helper, /browser.newContext\(device\)/u);
  assert.doesNotMatch(helper, /route\.fulfill|setContent|addInitScript/u);
  assert.match(helper, /manifest.baseline.after = await readReleaseEvidence/u);
  assert.match(helper, /manifest.candidate.after = await readReleaseEvidence/u);
  assert.match(helper, /\['home', '\/'\], \['menu', '\/'\], \['my-nights', '\/my-nights'\]/u);
});
