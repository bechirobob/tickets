import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const bootstrapModule = { exports: {} };
runInNewContext(transformSync(await readFile(new URL('../lib/staff-app-bootstrap.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: bootstrapModule, exports: bootstrapModule.exports });
const bootstrap = bootstrapModule.exports.default;
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
  const inline = '<Script id="staff-app-launch" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: staffAppBootstrap }} />';
  assert.ok(root.includes(inline) && root.indexOf(inline) < root.indexOf('<body>'));
  assert.doesNotMatch(root, /<Script[^>]+src=/);
  assert.doesNotMatch(bootstrap, /<\/script/i);
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

test('staff launch and offline routes agree while animation excludes staff actions', async () => {
  const arrivalModule = { exports: {} };
  runInNewContext(transformSync(await readFile(new URL('../lib/brand-arrival.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module: arrivalModule, exports: arrivalModule.exports, URL });
  const listeners = new Map();
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, self: { location: { origin }, addEventListener: (name, fn) => listeners.set(name, fn) },
    fetch: async () => { throw Error('offline'); }, caches: { match: async key => key },
  });
  const entries = ['/staff', '/admin', '/scan', '/organizer/workspace', '/organizer/analytics', '/organizer/assistant',
    ...['operations', 'events', 'registrations', 'promoters', 'orders', 'support', 'rooms', 'fees', 'yorkeway-audience',
      'platform-audience', 'hosts', 'accounts', 'account', 'help'].map(name => `/admin/${name}`)];
  const actions = ['/staff/install', '/admin/login', '/admin/orders/order-1', '/scan/history',
    '/organizer/workspace/event-1', '/organizer/activate', '/organizer/team', '/organizer/team/member-1'];
  const publicPaths = ['/events', '/my-nights', '/organizer', '/organizer/submit', '/staffing', '/administrator',
    '/scanner', '/organizer/workspaces', '/organizer/analytics-extra', '/organizer/assistants', '/organizer/activate-now', '/organizer/teams'];
  for (const [paths, staff, animated] of [[entries, true, true], [actions, true, false], [publicPaths, false, null]]) {
    for (const path of paths.flatMap(path => [path, `${path}/`])) {
      const href = `${origin}${path}?source=staff-pwa`;
      assert.equal(windowFixture(`${path}?source=staff-pwa`).root.dataset.staffApp === 'true', staff, `launch: ${path}`);
      assert.equal(windowFixture(path, { saved: true }).replacements.length === 0, staff, `restore: ${path}`);
      let response;
      listeners.get('fetch')({ request: { url: href, method: 'GET', mode: 'navigate' }, respondWith: value => { response = value; } });
      assert.equal(await response, staff ? '/offline-staff.html' : '/offline-ticket', `offline: ${path}`);
      if (staff) {
        assert.equal(arrivalModule.exports.eligibleArrivalEntry({ href, navigationHref: href, navigationType: 'navigate', referrer: '' }), animated, `animation: ${path}`);
      }
    }
  }
});
