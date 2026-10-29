import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bootstrap = await readFile(new URL('../public/staff-app.js', import.meta.url), 'utf8');
const origin = 'https://tickets.becoreops.com';
function windowFixture(path, { standalone = true, saved = false, blocked = false } = {}) {
  const storage = new Map(saved ? [['bct:staff-app:v1', '1']] : []), listeners = new Map(), replacements = [], opened = [];
  const root = { dataset: {}, style: {} };
  const location = { href: origin + path, pathname: new URL(origin + path).pathname, origin, replace: path => replacements.push(path) };
  const listen = (name, fn) => listeners.set(name, fn);
  class Element { constructor(link) { this.link = link; } closest() { return this.link; } }
  const context = { URL, Element, location, navigator: { standalone }, matchMedia: () => ({ matches: standalone }),
    sessionStorage: { getItem(key) { if (blocked) throw Error('blocked'); return storage.get(key); }, setItem(key, value) { if (blocked) throw Error('blocked'); storage.set(key, value); } },
    document: { documentElement: root, addEventListener: listen }, window: { addEventListener: listen, open: (...args) => opened.push(args) } };
  runInNewContext(bootstrap, context);
  return { storage, listeners, replacements, opened, root, location, Element };
}

test('staff and customer installs retain separate identities and launch destinations', async () => {
  const staff = JSON.parse(await readFile(new URL('../public/staff.webmanifest', import.meta.url)));
  const customer = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url)));
  assert.equal(staff.id, '/staff'); assert.equal(staff.start_url, '/staff?source=staff-pwa');
  assert.equal(staff.scope, '/'); assert.equal(staff.display, 'standalone');
  assert.equal(customer.id, '/'); assert.equal(customer.start_url, '/my-nights?source=pwa');
  const root = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(root, /manifest: "\/manifest.webmanifest\?v=5"/);
  assert.ok(root.indexOf('<Script src="/staff-app.js" strategy="beforeInteractive"') < root.indexOf('<body>'));
  for (const path of ['staff', 'admin', 'scan', 'organizer/workspace', 'organizer/analytics', 'organizer/assistant']) {
    assert.match(await readFile(new URL(`../app/${path}/layout.tsx`, import.meta.url), 'utf8'), /staffAppMetadata as metadata/);
  }
  assert.doesNotMatch(await readFile(new URL('../app/organizer/layout.tsx', import.meta.url), 'utf8'), /staffAppMetadata/);
});

test('only explicit standalone staff launches mark their own window', () => {
  for (const path of ['/staff?source=staff-pwa', '/admin?source=staff-pwa', '/scan?source=staff-pwa', '/organizer/workspace?source=staff-pwa']) {
    const app = windowFixture(path);
    assert.equal(app.storage.get('bct:staff-app:v1'), '1');
    assert.equal(app.root.dataset.staffApp, 'true'); assert.deepEqual(app.replacements, []);
  }
  for (const path of ['/', '/my-nights?source=pwa', '/my-nights?source=staff-pwa', '/events', '/admin', '/staff']) {
    const app = windowFixture(path);
    assert.equal(app.storage.size, 0); assert.equal(app.root.dataset.staffApp, undefined); assert.deepEqual(app.replacements, []);
  }
  assert.equal(windowFixture('/staff?source=staff-pwa', { standalone: false, saved: true }).root.dataset.staffApp, undefined);
  assert.equal(windowFixture('/staff?source=staff-pwa', { blocked: true }).root.dataset.staffApp, 'true');
});

test('staff window restoration never selects a customer destination', () => {
  for (const path of ['/', '/events', '/my-nights?source=pwa']) {
    const app = windowFixture(path, { saved: true });
    assert.deepEqual(app.replacements, ['/staff?source=staff-pwa']);
    assert.equal(app.root.style.visibility, 'hidden');
  }
  assert.deepEqual(windowFixture('/offline-ticket', { saved: true }).replacements, ['/offline-staff.html']);
  for (const path of ['/admin/account', '/admin/login?returnTo=%2Fscan', '/scan', '/organizer/workspace', '/staff/install', '/offline-staff.html']) {
    assert.deepEqual(windowFixture(path, { saved: true }).replacements, []);
  }
  for (const event of ['pageshow', 'popstate', 'staff-app-route']) {
    const app = windowFixture('/admin', { saved: true });
    app.location.pathname = '/events'; app.listeners.get(event)();
    assert.deepEqual(app.replacements, ['/staff?source=staff-pwa']);
  }
});

test('public links open separately from a staff window without an opener', () => {
  const app = windowFixture('/admin', { saved: true });
  let prevented = false, stopped = false;
  app.listeners.get('click')({ target: new app.Element({ href: '/events', hasAttribute: () => false }),
    preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.deepEqual(Array.from(app.opened[0]), [origin + '/events', '_blank', 'noopener,noreferrer']);
  assert.doesNotMatch(bootstrap, /localStorage|document\.cookie|fetch\(/);
});

test('offline navigation chooses staff recovery without removing pending local records', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners = new Map(), keys = [];
  runInNewContext(source, { URL, self: { location: { origin }, addEventListener: (name, fn) => listeners.set(name, fn) },
    fetch: async () => { throw Error('offline'); }, caches: { match: async key => { keys.push(key); return key; } } });
  for (const path of ['/staff?source=staff-pwa', '/admin/orders', '/scan', '/organizer/workspace', '/events', '/my-nights']) {
    let promise;
    listeners.get('fetch')({ request: { url: origin + path, method: 'GET', mode: 'navigate' }, respondWith: result => { promise = result; } });
    assert.equal(await promise, ['/events', '/my-nights'].includes(path) ? '/offline-ticket' : '/offline-staff.html');
  }
  assert.doesNotMatch(source, /localStorage|indexedDB/);
  assert.match(source, /becore-tickets-shell-v7/);
});
