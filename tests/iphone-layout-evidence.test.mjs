import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isReadOnlyRequest, readReleaseEvidence, verifyReleaseIdentity } from '../scripts/iphone-layout-evidence.mjs';

const revision = '45ec44e35f8b0e5099a328ce219df2529374f9ee';
const version = { service: 'becore-tickets', revision };
const health = { ...version, runtime: 'vps', active: true };

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
