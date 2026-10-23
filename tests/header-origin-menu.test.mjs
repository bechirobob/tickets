import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../app/mobile-navigation.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;

// Execute the component's real layout effect against changing DOM measurements.
// Hosted browser tests separately exercise pixels, clipping and hit testing.
function mount({ phase = 'open', width = 390, height = 664, capWidth = 76, dockTop = 574 } = {}) {
  const window = new EventTarget();
  window.innerWidth = width; window.innerHeight = height;
  window.visualViewport = Object.assign(new EventTarget(), { offsetTop: 0, width, height });
  const document = new EventTarget();
  document.visibilityState = 'visible'; document.body = {};
  document.querySelector = () => dockTop ? { getBoundingClientRect: () => ({ top: dockTop, height: 68 }) } : null;
  const styles = new Map();
  const rect = { top: 8, bottom: 52, right: width - 18, width: capWidth, height: 44 };
  const layout = [], closes = [];
  let observerDisconnected = false;
  const component = { exports: {} };
  runInNewContext(compiled, {
    module: component, exports: component.exports, window, document,
    ResizeObserver: class { observe() {} disconnect() { observerDisconnected = true; } },
    require(name) {
      if (name === 'react') return {
        useEffect() {}, useLayoutEffect(callback) { layout.push(callback); },
        useRef: value => ({ current: value }), useSyncExternalStore: () => width <= 760,
      };
      if (name === 'react-dom') return { createPortal: element => element };
      if (name === 'next/navigation') return { usePathname: () => '/events' };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === './use-header-panel') return { useHeaderPanel: duration => {
        assert.equal(duration, 160);
        return { open: phase === 'open', phase, ready: true, id: 'menu', toggle() {}, close: (...args) => closes.push(args),
          trigger: { current: { getBoundingClientRect: () => rect } },
          panel: { current: { setAttribute() {}, removeAttribute() {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) } } },
        };
      } };
      return require(name);
    },
  });
  const tree = component.exports.default({ primaryVisible: false });
  const cleanup = layout.map(callback => callback());
  return { styles, rect, closes, tree, window, document, cleanup() { cleanup.forEach(fn => fn?.()); }, get disconnected() { return observerDisconnected; } };
}

for (const width of [320, 390, 1280]) test(`menu uses exact button rectangle at ${width}px, not the header bottom`, () => {
  const view = mount({ width, capWidth: width > 760 ? 44 : 76 });
  assert.equal(view.styles.get('--menu-anchor-top'), '8px');
  assert.equal(view.styles.get('--menu-anchor-right'), '18px');
  assert.equal(view.styles.get('--menu-anchor-width'), width > 760 ? '44px' : '76px');
  assert.equal(view.styles.get('--menu-anchor-height'), '44px');
  assert.equal(view.styles.get('--menu-max-height'), '558px');
  view.cleanup(); assert.equal(view.disconnected, true);
});

test('scroll, resize and visual viewport changes remeasure; cleanup removes listeners', () => {
  const view = mount();
  view.rect.top = 10; view.rect.bottom = 54;
  view.window.dispatchEvent(new Event('scroll'));
  assert.equal(view.styles.get('--menu-anchor-top'), '10px');
  view.window.visualViewport.height = 320;
  view.window.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(view.styles.get('--menu-max-height'), '302px');
  view.cleanup(); view.rect.top = 30;
  view.window.dispatchEvent(new Event('resize'));
  assert.equal(view.styles.get('--menu-anchor-top'), '10px');
});

test('transient hidden or zero viewport never closes or poisons menu placement; foreground remeasures', () => {
  const view = mount();
  view.document.visibilityState = 'hidden'; view.window.visualViewport.height = 0;
  view.window.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(view.styles.get('--menu-max-height'), '558px'); assert.deepEqual(view.closes, []);
  view.document.visibilityState = 'visible';
  view.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(view.closes, []);
  view.window.visualViewport.height = 400;
  view.window.dispatchEvent(new Event('pageshow'));
  assert.equal(view.styles.get('--menu-max-height'), '384px');
  view.cleanup();
});

test('unusable visible viewport closes safely instead of rendering inaccessible controls', () => {
  const view = mount({ height: 80, dockTop: null });
  assert.deepEqual(view.closes, [[true, true]]); view.cleanup();
});

test('closed state does not subscribe to layout; exiting state remains mounted for reverse motion', () => {
  const closed = mount({ phase: 'closed' });
  assert.equal(closed.styles.size, 0); closed.cleanup();
  const closing = mount({ phase: 'closing' });
  assert.equal(closing.styles.get('--menu-anchor-top'), '8px'); closing.cleanup();
});


test('a 44px cap preserves taps but captures a real downward swipe, including over its close button', () => {
  const view = mount({ width: 320, capWidth: 44 });
  const nav = view.tree.props.children[1].props.children;
  const header = nav.props.children[0];
  const captures = [];
  const pointer = (y, timeStamp) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: 280, clientY: y, timeStamp,
    currentTarget: { setPointerCapture: id => captures.push(id) }, target: { tagName: 'BUTTON' } });
  header.props.onPointerDown(pointer(10, 0));
  header.props.onPointerMove(pointer(13, 20));
  header.props.onPointerUp(pointer(13, 40));
  assert.deepEqual(captures, []); assert.deepEqual(view.closes, []);
  header.props.onPointerDown(pointer(10, 50));
  header.props.onPointerMove(pointer(80, 100));
  assert.deepEqual(captures, [1]);
  assert.equal(view.styles.get('--menu-drag-y'), '70px');
  header.props.onPointerUp(pointer(80, 120));
  assert.deepEqual(view.closes, [[true]]);
  assert.equal(view.styles.has('--menu-drag-y'), false);
  view.cleanup();
});
