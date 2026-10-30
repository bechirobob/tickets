import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const bootstrapModule = { exports: {} };
runInNewContext(transformSync(await readFile(new URL('../lib/scanner-app-bootstrap.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: bootstrapModule, exports: bootstrapModule.exports });
function launch(path, { saved = false, standalone = true, blocked = false } = {}) {
  const records = new Map(saved ? [['bct:scanner-app:v1', '1']] : []);
  const replacements = [], listeners = new Map(), root = { dataset: {}, style: {} };
  const location = { href: 'https://tickets.becoreops.com' + path, pathname: new URL('https://tickets.becoreops.com' + path).pathname, replace: path => replacements.push(path) };
  runInNewContext(bootstrapModule.exports.default, {
    URL, location, navigator: { standalone }, matchMedia: () => ({ matches: standalone }),
    sessionStorage: { getItem: key => { if (blocked) throw Error(); return records.get(key); }, setItem: (key, value) => { if (blocked) throw Error(); records.set(key, value); } },
    document: { documentElement: root }, window: { addEventListener: (name, fn) => listeners.set(name, fn) },
  });
  return { records, replacements, listeners, root, location };
}
test('scanner install has a third identity and a scanner launch URL', async () => {
  const manifests = await Promise.all(['manifest','staff','scanner'].map(name => readFile(new URL(`../public/${name}.webmanifest`, import.meta.url), 'utf8').then(JSON.parse)));
  assert.equal(new Set(manifests.map(value => value.id)).size, 3);
  assert.equal(manifests[2].start_url, '/scan/app?source=scanner-pwa');
  assert.equal(manifests[2].display, 'standalone');
});
test('scanner identity is explicit and local to an installed window', () => {
  assert.equal(launch('/scan/app?source=scanner-pwa').root.dataset.scannerApp, 'true');
  assert.equal(launch('/scan/app?source=scanner-pwa', { blocked: true }).root.dataset.scannerApp, 'true');
  for (const path of ['/scan', '/staff?source=staff-pwa', '/my-nights?source=pwa']) assert.equal(launch(path).records.size, 0);
  assert.equal(launch('/scan/app?source=scanner-pwa', { standalone: false }).records.size, 0);
});
test('restoration keeps scanner, install and required password change inside the app', () => {
  for (const path of ['/scan/app', '/scan/install', '/admin/account', '/offline-scanner.html']) assert.deepEqual(launch(path, { saved: true }).replacements, []);
  for (const path of ['/admin', '/organizer/workspace', '/my-nights', '/staff', '/scan']) {
    const app = launch(path, { saved: true });
    assert.deepEqual(app.replacements, ['/scan/app?source=scanner-pwa']);
    assert.equal(app.root.style.visibility, 'hidden');
  }
  assert.deepEqual(launch('/offline-ticket', { saved: true }).replacements, ['/offline-scanner.html']);
  for (const event of ['pageshow', 'popstate', 'staff-app-route']) {
    const app = launch('/scan/app', { saved: true }); app.location.pathname = '/events'; app.listeners.get(event)();
    assert.deepEqual(app.replacements, ['/scan/app?source=scanner-pwa']);
  }
});
test('offline scanner navigation returns to the scanner without changing saved records', async () => {
  const listeners = new Map();
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  runInNewContext(source, { URL, self: { location: { origin: 'https://tickets.becoreops.com' }, addEventListener: (name, fn) => listeners.set(name, fn) }, fetch: async () => { throw Error('offline'); }, caches: { match: async key => key } });
  for (const path of ['/scan/app', '/scan/install']) {
    let response; listeners.get('fetch')({ request: { method: 'GET', mode: 'navigate', url: 'https://tickets.becoreops.com' + path }, respondWith: value => { response = value; } });
    assert.equal(await response, '/offline-scanner.html');
  }
  assert.doesNotMatch(source, /localStorage|indexedDB/);
});

for (const [status, result, mode, feedback] of [
  [200, 'valid', 'valid', 'Entry recorded.'],
  [409, 'duplicate', 'duplicate', 'This ticket was already checked in.'],
  [400, 'invalid', 'invalid', 'Entry could not be confirmed.'],
  [503, undefined, 'unconfirmed', 'Entry could not be confirmed.'],
]) test(`scanner fallback feedback does not claim admission for HTTP ${status}`, async () => {
  const source = await readFile(new URL('../app/scan/scanner.tsx', import.meta.url), 'utf8');
  const marker = 'const checkTicket = useCallback(';
  const start = source.indexOf(marker) + marker.length;
  const callback = source.slice(start, source.indexOf('\n  }, [', start) + '\n  }'.length);
  const compiled = transformSync(`const callback=${callback};`, { loader: 'ts' }).code;
  let actualMode, actualMessage, offlineCalls = 0;
  const scope = {
    busyRef: { current: false }, crypto: { randomUUID: () => 'synthetic-scan' }, scannerRef: { current: { pause() {} } },
    setMode: value => { actualMode = value; }, setMessage: value => { actualMessage = value; }, navigator: { onLine: true },
    offlineCheck: async () => { offlineCalls++; }, fetch: async () => Response.json({ result }, { status }), AbortSignal,
    eventSlug: 'synthetic-event', currentEvent: { current: 'synthetic-event' }, deviceId: 'synthetic-device',
    denyGateAccess: () => false, markContact() {}, setTicket() {}, loadEventState: async () => {},
  };
  const check = new Function(...Object.keys(scope), `${compiled};return callback;`)(...Object.values(scope));
  await check('BCT-ABCD-EFGH-IJKL-MNOP');
  assert.equal(actualMode, mode); assert.equal(actualMessage, feedback); assert.equal(offlineCalls, 0);
  assert.equal(scope.busyRef.current, false);
});
