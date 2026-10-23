import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const require = createRequire(import.meta.url);
const compile = async path => transformSync(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;
const viewportCode = await compile('../lib/mobile-viewport.ts');
const errorCode = await compile('../app/global-error.tsx');
const pwaCode = await compile('../app/pwa-registration.tsx');
function fixture() {
  const document = new EventTarget(), window = new EventTarget(), viewport = new EventTarget();
  const values = new Map(), frames = new Map(); let id = 0;
  document.hidden = false;
  document.documentElement = { style: { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k) }, dataset: {} };
  class HTMLElement { matches() { return true; } }
  Object.assign(viewport, { height: 800, offsetTop: 0, scale: 1 });
  Object.assign(window, { visualViewport: viewport, innerHeight: 800, requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: n => frames.delete(n) });
  const runtimeModule = { exports: {} };
  vm.runInNewContext(viewportCode, { module: runtimeModule, exports: runtimeModule.exports, window, document, HTMLElement });
  const cleanup = runtimeModule.exports.mountMobileViewport();
  return { window, document, viewport, values, frames, HTMLElement, cleanup, mount: runtimeModule.exports.mountMobileViewport,
    fire: (target, event) => target.dispatchEvent(new Event(event)),
    paint() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); } };
}

test('suspension never records hidden or zero geometry; foreground repairs without a resize event', () => {
  const f = fixture();
  assert.equal(f.values.get('--app-viewport-height'), '800px');
  f.document.hidden = true; f.viewport.height = 0;
  f.fire(f.viewport, 'resize'); f.fire(f.document, 'visibilitychange');
  assert.equal(f.values.get('--app-viewport-height'), '800px');
  assert.equal(f.frames.size, 0);
  f.document.hidden = false;
  f.fire(f.document, 'visibilitychange');
  assert.equal(f.values.get('--app-viewport-height'), '800px');
  f.viewport.height = 720; f.paint();
  assert.equal(f.values.get('--app-viewport-height'), '720px');
  f.cleanup();
});

test('BFCache pageshow and repeated resumes coalesce and retain keyboard/pinch geometry', () => {
  const f = fixture();
  f.viewport.height = 660;
  f.fire(f.window, 'pageshow'); f.fire(f.window, 'pageshow');
  assert.equal(f.frames.size, 1);
  assert.equal(f.values.get('--app-viewport-height'), '660px');
  f.document.activeElement = new f.HTMLElement(); f.viewport.height = 400;
  f.fire(f.document, 'focusin');
  assert.equal(f.document.documentElement.dataset.keyboard, 'open');
  f.viewport.scale = 2; f.viewport.height = 200; f.paint();
  assert.equal(f.values.get('--app-viewport-height'), '400px');
  f.viewport.scale = 1; f.document.activeElement = null; f.viewport.height = 800;
  f.fire(f.document, 'focusout');
  assert.equal(f.document.documentElement.dataset.keyboard, 'closed');
  f.cleanup();
});

test('resume frame cannot mutate a rehidden or unmounted document; StrictMode can remount', () => {
  const f = fixture(); f.fire(f.window, 'pageshow');
  f.document.hidden = true; f.viewport.height = 0; f.paint();
  assert.equal(f.values.get('--app-viewport-height'), '800px');
  f.document.hidden = false; f.fire(f.window, 'pageshow'); f.cleanup();
  assert.equal(f.frames.size, 0); assert.equal(f.values.size, 0);
  for (const [target, type] of [[f.window, 'pageshow'], [f.window, 'resize'], [f.document, 'visibilitychange'], [f.document, 'focusin'], [f.viewport, 'resize'], [f.viewport, 'scroll']]) assert.equal(getEventListeners(target, type).length, 0);
  f.viewport.height = 750; const cleanup = f.mount();
  assert.equal(f.values.get('--app-viewport-height'), '750px'); cleanup();
});

test('nonfinite geometry cannot poison viewport CSS', () => {
  const f = fixture();
  for (const height of [0, -1, NaN, Infinity]) { f.viewport.height = height; f.fire(f.viewport, 'resize'); assert.equal(f.values.get('--app-viewport-height'), '800px'); }
  f.viewport.height = 600; f.viewport.offsetTop = NaN; f.fire(f.viewport, 'scroll');
  assert.equal(f.values.get('--app-viewport-height'), '800px'); f.cleanup();
});

test('root error renders independently and reloads only on explicit user action', () => {
  const runtimeModule = { exports: {} }; let reloaded = 0, reset = 0;
  vm.runInNewContext(errorCode, { module: runtimeModule, exports: runtimeModule.exports, require, window: { location: { reload: () => reloaded++ } } });
  const component = runtimeModule.exports.default;
  const html = renderToStaticMarkup(createElement(component, { error: new Error('private runtime details'), reset: () => reset++ }));
  assert.match(html, /<html lang="en-GB">/); assert.match(html, /role="alert"/);
  assert.match(html, /Reloading may lose unsent changes/); assert.match(html, /href="\/offline-ticket\.html"/);
  assert.doesNotMatch(html, /private runtime details/); assert.equal(reloaded, 0);
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
  const tree = component({ error: new Error(), reset: () => reset++ });
  const buttons = nodes(tree).filter(node => node.type === 'button');
  buttons[0].props.onClick(); assert.equal(reset, 1); assert.equal(reloaded, 0);
  buttons[1].props.onClick(); assert.equal(reloaded, 1);
});

test('optional PWA registration rejection and unavailable storage do not break the shell', async () => {
  const effects = [], runtimeModule = { exports: {} };
  const window = new EventTarget(); let timers = 0;
  Object.assign(window, { matchMedia: () => ({ matches: false }), setTimeout: () => { timers++; return 1; }, clearTimeout() {} });
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
  const navigator = { userAgent: 'iPhone', serviceWorker: { register: async () => { throw new Error('Offline'); } } };
  // Eligible attendee, otherwise this component deliberately never reads dismissal storage.
  let state = 0;
  vm.runInNewContext(pwaCode, { module: runtimeModule, exports: runtimeModule.exports, window, navigator, fetch: async () => ({ ok: true }),
    require: name => name === 'react' ? { useEffect: fn => effects.push(fn), useState: value => [++state === 4 ? true : value, () => {}] } : name === 'next/navigation' ? { usePathname: () => '/my-nights' } : name === '../lib/client-analytics' ? { trackProductMetric() {} } : name === 'next/image' ? { default: () => null } : require(name) });
  assert.equal(runtimeModule.exports.default(), null);
  const cleanups = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers, 0);
  for (const fn of cleanups) fn?.();
});

test('viewport lifecycle leaves healthy/empty/loading routes, drafts, storage and offline state alone', () => {
  const f = fixture();
  let navigations = 0;
  f.window.location = { reload() { navigations++; }, assign() { navigations++; } };
  Object.defineProperty(f.window, 'localStorage', { get() { throw new Error('Must not touch saved data'); } });
  // Existing route content is never inspected, replaced or heuristically treated as blank.
  for (const content of ['', 'Loading…', 'Unsent booking notes']) {
    f.document.routeContent = content;
    f.document.hidden = true; f.fire(f.document, 'visibilitychange');
    f.document.hidden = false; f.fire(f.document, 'visibilitychange');
    f.fire(f.window, 'pageshow'); f.paint();
    assert.equal(f.document.routeContent, content);
  }
  assert.equal(navigations, 0); f.cleanup();
});

test('recovery styling is allowed by production CSP and static offline entry is packaged', async () => {
  const policy = await readFile(new URL('../worker/security-response.ts', import.meta.url), 'utf8');
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  const offline = await readFile(new URL('../public/offline-ticket.html', import.meta.url), 'utf8');
  assert.match(offline, /My offline tickets/);
  const layout = await readFile(new URL('../app/mobile-app-frame.tsx', import.meta.url), 'utf8');
  assert.match(layout, /useEffect\(mountMobileViewport, \[\]\)/);
});

test('installed Vinext boundary renders custom global fallback for an actual error state', async () => {
  const { ErrorBoundaryInner } = await import('../node_modules/vinext/dist/shims/error-boundary.js');
  const runtimeModule = { exports: {} };
  vm.runInNewContext(errorCode, { module: runtimeModule, exports: runtimeModule.exports, require });
  const boundary = new ErrorBoundaryInner({ fallback: runtimeModule.exports.default, pathname: '/events', children: createElement('main', null, 'Healthy route') });
  assert.match(renderToStaticMarkup(boundary.render()), /Healthy route/);
  boundary.state = { ...boundary.state, ...ErrorBoundaryInner.getDerivedStateFromError(new Error('Root layout failed')) };
  assert.match(renderToStaticMarkup(boundary.render()), /Let’s get your page back/);
});

const roomViewportCode = await compile('../lib/room-viewport.ts');
function roomFixture() {
  const f = fixture(); f.cleanup();
  const runtimeModule = { exports: {} }, heights = [];
  vm.runInNewContext(roomViewportCode, { module: runtimeModule, exports: runtimeModule.exports, window: f.window, document: f.document });
  return { ...f, heights, mountRoom: runtimeModule.exports.mountRoomViewport,
    cleanupRoom: runtimeModule.exports.mountRoomViewport(height => heights.push(height)) };
}

test('Room retains its full height during suspension and restores on foreground/BFCache without resize', () => {
  const f = roomFixture();
  assert.deepEqual(f.heights, [800]);
  f.document.hidden = true; f.viewport.height = 0;
  f.fire(f.viewport, 'resize'); f.fire(f.document, 'visibilitychange');
  assert.deepEqual(f.heights, [800]);
  f.document.hidden = false; f.fire(f.window, 'pageshow');
  assert.deepEqual(f.heights, [800]);
  f.viewport.height = 720; f.paint();
  assert.deepEqual(f.heights, [800, 720]);
  f.document.hidden = true; f.fire(f.document, 'visibilitychange');
  f.viewport.height = 680; f.document.hidden = false; f.fire(f.document, 'visibilitychange'); f.paint();
  assert.equal(f.heights.at(-1), 680); f.cleanupRoom();
});

test('Room keeps valid keyboard sizes, ignores pinch/invalid measurements, and cleans all lifecycle listeners', () => {
  const f = roomFixture();
  f.viewport.height = 350; f.fire(f.viewport, 'resize'); assert.equal(f.heights.at(-1), 350);
  const count = f.heights.length;
  for (const height of [0, -1, NaN, Infinity]) { f.viewport.height = height; f.fire(f.viewport, 'resize'); }
  f.viewport.scale = 2; f.viewport.height = 200; f.fire(f.viewport, 'resize');
  assert.equal(f.heights.length, count);
  f.viewport.scale = 1; f.viewport.height = 800;
  f.fire(f.window, 'pageshow'); f.fire(f.window, 'pageshow'); assert.equal(f.frames.size, 1);
  f.cleanupRoom(); assert.equal(f.frames.size, 0);
  for (const [target, type] of [[f.viewport, 'resize'], [f.window, 'pageshow'], [f.document, 'visibilitychange']]) assert.equal(getEventListeners(target, type).length, 0);
  const cleanup = f.mountRoom(height => f.heights.push(height));
  assert.equal(f.heights.at(-1), 800); cleanup();
  f.window.visualViewport = null;
  assert.doesNotThrow(() => f.mountRoom(() => assert.fail('No visual viewport'))());
});

test('Room wiring preserves conditional near-bottom scrolling and does not alter draft or navigation state', async () => {
  const source = await readFile(new URL('../app/room/[slug]/room-client.tsx', import.meta.url), 'utf8');
  assert.match(source, /useEffect\(\(\) => mountRoomViewport/);
  assert.match(source, /if \(nearBottomRef.current && streamRef.current\) streamRef.current.scrollTop = streamRef.current.scrollHeight/);
  const helper = await readFile(new URL('../lib/room-viewport.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /localStorage|sessionStorage|location\.|fetch\(|setDraft|setInterval/);
});
