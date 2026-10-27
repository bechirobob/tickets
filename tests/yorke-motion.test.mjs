import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('../lib/yorke-motion.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
function fixture(options = {}) {
  let next = 0, now = 100;
  const frames = new Map(), timers = new Map(), effects = [], targets = [];
  const target = () => {
    const listeners = new Map();
    const value = { addEventListener(type, fn) { const list = listeners.get(type) ?? []; list.push(fn); listeners.set(type, list); }, removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn)); }, dispatch(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ type }); }, listeners };
    targets.push(value); return value;
  };
  const document = Object.assign(target(), { hidden: options.hidden ?? false });
  const motion = Object.assign(target(), { matches: options.reduce ?? false });
  const window = Object.assign(target(), {
    location: { href: 'https://tickets.becoreops.com/the-yorke-way' }, scrollY: options.scrollY ?? 0,
    matchMedia: () => motion,
    requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const performance = { getEntriesByType: () => options.interacted ? [{}] : [], now: () => now };
  const element = name => ({ animate(keyframes, timing) { if (options.animationFailure && effects.length === 2) throw Error('animate unavailable'); const effect = { name, keyframes, timing, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; } }; effects.push(effect); return effect; } });
  const phrases = [0, 1, 2, 3].map(i => element(`phrase-${i}`));
  const root = Object.assign(element('root'), { querySelectorAll: () => phrases, querySelector: selector => element(selector) });
  if (options.noAnimation) root.animate = undefined;
  const entry = { href: window.location.href, navigationHref: window.location.href, navigationType: 'navigate', referrer: '', discarded: false, prerendering: false, capturedAt: now, phase: options.phase ?? 'pending', ...options.entry };
  const component = { exports: {} };
  runInNewContext(compiled, { module: component, exports: component.exports, document, window, performance, URL });
  return {
    document, window, entry, motion, effects, frames, timers,
    mount() { return component.exports.mountYorkeMotion(root, entry); },
    frame() { const queued = [...frames.values()]; frames.clear(); for (const fn of queued) fn(); },
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
    assertStopped() { assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.ok(effects.every(effect => effect.cancelled)); assert.ok(targets.every(target => [...target.listeners.values()].every(list => list.length === 0))); },
  };
}

test('editorial waits for actual doorway completion, then shares one scene origin', () => {
  const p = fixture(); p.mount();
  assert.equal(p.effects.length, 6);
  assert.ok(p.effects.every(effect => effect.timing.fill === 'backwards' && effect.timing.delay >= 2600));
  p.frame(); assert.ok(p.effects.every(effect => effect.currentTime === 0));
  p.entry.phase = 'shown'; p.frame(); assert.ok(p.effects.every(effect => effect.currentTime === 0));
  p.entry.phase = 'done'; p.frame(); assert.ok(p.effects.every(effect => effect.currentTime === 2600));
  assert.equal(p.frames.size, 0);
  assert.deepEqual(p.effects.slice(0, 4).map(effect => effect.timing.delay - 2600), [150, 520, 1070, 1480]);
  assert.equal(p.effects.at(-1).timing.iterations, 3);
  p.advance(4900); p.assertStopped();
});

test('an already skipped opening starts on the next frame, not after a guessed two seconds', () => {
  const p = fixture({ phase: 'done' }); p.mount(); p.frame();
  assert.ok(p.effects.every(effect => effect.currentTime === 2600));
});

for (const options of [{ reduce: true }, { hidden: true }, { scrollY: 1 }, { interacted: true }, { noAnimation: true }, { entry: { late: true } }, { entry: { capturedAt: -500 } }, { entry: { href: 'https://tickets.becoreops.com/events', navigationHref: 'https://tickets.becoreops.com/events', phase: 'done' } }, { entry: { navigationType: 'back_forward' } }, { entry: { href: 'https://tickets.becoreops.com/the-yorke-way?token=x' } }]) {
  test(`static readable bypass: ${JSON.stringify(options)}`, () => { const p = fixture(options); p.mount(); assert.equal(p.effects.length, 0); p.assertStopped(); });
}

for (const event of ['pointerdown', 'keydown', 'wheel', 'focusin']) {
  test(`${event} immediately reveals everything without preventing signup input`, () => {
    const p = fixture(); p.mount(); p.document.dispatch(event); p.assertStopped();
    p.entry.phase = 'done'; p.frame(); assert.equal(p.effects.length, 6);
    p.mount(); assert.equal(p.effects.length, 6);
  });
}

test('reduced motion changes, hidden documents and route departure cancel pending effects', () => {
  for (const kind of ['motion', 'visibility', 'route']) {
    const p = fixture(); p.mount();
    if (kind === 'motion') { p.motion.matches = true; p.motion.dispatch('change'); }
    if (kind === 'visibility') { p.document.hidden = true; p.document.dispatch('visibilitychange'); }
    if (kind === 'route') { p.window.location.href += '/confirm'; p.frame(); }
    p.assertStopped();
  }
});

test('rerender or SPA return does not replay, while a fresh document gets its own scene', () => {
  const p = fixture({ phase: 'done' }); const cleanup = p.mount(); p.frame(); cleanup();
  p.mount(); assert.equal(p.effects.length, 6);
  const fresh = fixture({ phase: 'done' }); fresh.mount(); fresh.frame(); assert.equal(fresh.effects.length, 6);
});

test('StrictMode cleanup before first frame can safely retry; duplicate mounts cannot claim the scene', () => {
  const p = fixture(); const first = p.mount(); p.mount(); assert.equal(p.effects.length, 6);
  first(); p.assertStopped(); p.mount(); assert.equal(p.effects.length, 12);
  p.entry.phase = 'done'; p.frame(); assert.ok(p.effects.slice(6).every(effect => effect.currentTime === 2600));
});

test('unresolved intro and partial animation failure fail open with full cleanup', () => {
  const pending = fixture(); pending.mount(); pending.advance(2600); pending.assertStopped();
  const failure = fixture({ animationFailure: true }); failure.mount(); failure.assertStopped();
});

test('server content is complete without animation and the form remains outside its controller', async () => {
  const page = await readFile(new URL('../app/the-yorke-way/page.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/the-yorke-way/yorke-way.css', import.meta.url), 'utf8');
  const component = await readFile(new URL('../app/the-yorke-way/yorke-motion.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/data-yorke-phrase/g) ?? []).length, 4);
  for (const phrase of ['Your year-end', 'plans called.', 'They said', 'Kofi Bills.']) assert.ok(page.includes(phrase));
  assert.ok(page.indexOf('</YorkeMotion>') < page.indexOf('<YorkeSignup />'));
  assert.doesNotMatch(component, /\b(?:hidden|inert)\b|opacity/);
  assert.doesNotMatch(css, /yorke-arrive/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
