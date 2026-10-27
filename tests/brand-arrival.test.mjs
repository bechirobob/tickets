import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../lib/brand-arrival.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const origin = 'https://tickets.becoreops.com';

// Run the actual document controller, not a reimplementation. Browser tests
// retain responsibility for native event ordering, CSS, SVG and real history.
function fixture(options = {}) {
  const targets = [], frames = new Map(), timers = new Map(), images = [], shows = [];
  let now = options.now ?? 100, nextId = 0;
  function target() {
    const listeners = new Map();
    const object = {
      listeners,
      addEventListener(type, fn, capture = false) {
        const entries = listeners.get(type) ?? [];
        if (!entries.some(entry => entry.fn === fn && entry.capture === capture)) entries.push({ fn, capture });
        listeners.set(type, entries);
      },
      removeEventListener(type, fn, capture = false) {
        listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry.fn !== fn || entry.capture !== capture));
      },
      dispatch(type, detail = {}) {
        const event = { type, target: object, defaultPrevented: false, propagationStopped: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; },
          stopImmediatePropagation() { this.propagationStopped = true; this.immediatePropagationStopped = true; }, ...detail };
        for (const { fn } of [...(listeners.get(type) ?? [])]) fn(event);
        return event;
      },
    };
    targets.push(object);
    return object;
  }
  const document = Object.assign(target(), { hidden: options.hidden ?? false, referrer: options.referrer ?? '', wasDiscarded: options.discarded ?? false, prerendering: options.prerendering ?? false });
  const motion = Object.assign(target(), { matches: options.reducedMotion ?? false });
  const window = Object.assign(target(), {
    location: { href: new URL(options.path ?? '/events', origin).href }, innerWidth: 390, innerHeight: 844, scrollY: options.scrollY ?? 0,
    matchMedia() { if (options.motionFailure) throw new Error('Media query unavailable'); return motion; },
    getComputedStyle() { if (options.cssFailure) throw new Error('Style unavailable'); return { getPropertyValue: () => options.cssReady === false ? '' : '1' }; },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new Error('Arrival must not use storage'); } });
  const attributes = new Map(), style = new Map();
  let hidden = false;
  const root = Object.assign(target(), {
    style: { setProperty(name, value) { if (options.styleFailure) throw new Error('Style write unavailable'); style.set(name, value); } },
    contains(node) { return node === root || node === skip; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  });
  Object.defineProperty(root, 'hidden', { get: () => hidden, set(value) { hidden = value; if (!value) shows.push(now); } });
  const skip = {};
  function Image() {
    if (options.imageFailure) throw new Error('Image constructor unavailable');
    this.complete = options.cached !== false; this.naturalWidth = options.cached === false ? 0 : 239;
    this.onload = null; this.onerror = null;
    images.push(this);
  }
  const navigation = { name: new URL(options.navigationPath ?? options.path ?? '/events', origin).href, type: options.navigationType ?? 'navigate' };
  const performance = { now: () => now, getEntriesByType(type) { if (options.performanceFailure) throw new Error('Timing unavailable'); return type === 'first-input' ? options.firstInput ? [{}] : [] : options.noNavigation ? [] : [navigation]; } };
  const component = { exports: {} };
  const context = { module: component, exports: component.exports, window, document, performance, Image, URL, Symbol, WeakMap, Set };
  runInNewContext(compiled, context);
  const api = component.exports;
  const entry = api.captureArrivalDocument();
  let cleanup = () => {};
  function advance(milliseconds) {
    const end = now + milliseconds;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  }
  return {
    api, context, document, window, motion, root, skip, images, attributes, style, frames, timers, shows, entry,
    get listeners() { return targets.reduce((count, value) => count + [...value.listeners.values()].reduce((total, entries) => total + entries.length, 0), 0); },
    mount(value = entry) { cleanup = api.mountBrandArrival(root, value); return cleanup; },
    unmount() { cleanup(); },
    advance,
    frame(milliseconds = 16) { advance(milliseconds); const queued = [...frames]; frames.clear(); for (const [, callback] of queued) callback(now); },
    takeFrame() { const [id, callback] = frames.entries().next().value; frames.delete(id); return () => callback(now); },
    load() { const image = images.at(-1); image.complete = true; image.naturalWidth = 239; image.onload?.(); },
    failImage() { images.at(-1).onerror?.(); },
    navigate(path) { window.location.href = new URL(path, origin).href; },
    hide(value = true) { document.hidden = value; document.dispatch('visibilitychange'); },
    reduce(value = true) { motion.matches = value; motion.dispatch('change'); },
    assertClosed() {
      assert.equal(root.hidden, true); assert.equal(attributes.has('data-running'), false);
      assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(this.listeners, 0);
      for (const image of images) { assert.equal(image.onload, null); assert.equal(image.onerror, null); }
    },
  };
}

for (const path of ['/', '/the-yorke-way', '/the-yorke-way/', '/the-yorke-way?utm_source=message', '/events', '/events?utm_source=message', '/event/one?ref=PROMOTER', '/hosts', '/hosts/one', '/about', '/help', '/privacy', '/terms', '/my-nights', '/my-nights?source=pwa', '/my-nights?view=rsvps']) {
  test(`fresh public document is eligible: ${path}`, () => {
    const page = fixture({ path });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), true);
  });
}

for (const path of ['/the-yorke-way/confirm', '/the-yorke-way/unsubscribe', '/the-yorke-way/other', '/the-yorke-way-extra', '/the-yorke-way?token=secret', '/the-yorke-way#token=secret', '/payment/return', '/checkout/one', '/rsvp/access#token=secret', '/rsvp/one', '/tickets', '/my-nights/one?view=passes', '/my-nights/access', '/scan', '/admin/login', '/organizer/workspace', '/room/one', '/account/privacy', '/auth/callback', '/api/customer/session', '/notifications', '/unknown']) {
  test(`critical or unapproved document is ineligible: ${path}`, () => {
    const page = fixture({ path });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false);
    page.mount(); page.assertClosed(); assert.equal(page.entry.phase, 'done');
  });
}

test('callback, recovery and direct-pass intents never animate on an otherwise public route', () => {
  for (const query of ['welcome=1', 'recovered=1', 'recover=1', 'transfer=accepted', 'token=t', 'claim=c', 'reference=r', 'trxref=r', 'pending=1', 'prompt=1', 'code=c', 'state=s', 'error=e', 'payment=success', 'payment_intent=p', 'redirect_status=succeeded', 'client_secret=s', 'access_token=s', 'refresh_token=s', 'transaction_id=t', 'register=1', 'view=passes', 'view=purchase', 'view=ticket', 'view=qr', 'kind=transfer', 'CLAIM=c']) {
    const page = fixture({ path: `/my-nights?${query}` });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false, query);
  }
  for (const hash of ['#token=t', '#claim=c', '#code=c&state=s', '#access_token=t', '#refresh_token=t', '#transfer=t']) {
    const page = fixture({ path: `/events${hash}` });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false, hash);
  }
});

test('initial navigation URL remains authoritative after callback parameters are removed', () => {
  for (const navigationPath of ['/my-nights?welcome=1', '/my-nights?recovered=1', '/my-nights/access#token=secret']) {
    const page = fixture({ path: '/my-nights', navigationPath });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false);
  }
});

test('critical same-origin and known payment/auth provider referrers skip the public destination', () => {
  for (const referrer of [`${origin}/payment/return`, `${origin}/checkout/one`, `${origin}/my-nights/access`, `${origin}/rsvp/access`, `${origin}/admin`, `${origin}/room/one`, `${origin}/my-nights?welcome=1`, 'https://checkout.paystack.com/payment', 'https://paystack.co/pay', 'https://checkout.stripe.com/pay', 'https://commerce.coinbase.com/pay', 'https://accounts.google.com/signin', 'https://pay.seevplus.com/pay']) {
    const page = fixture({ referrer });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false, referrer);
  }
  for (const referrer of [`${origin}/events`, `${origin}/event/one?ref=PROMOTER`, 'https://www.google.com/search?q=tickets']) {
    const page = fixture({ referrer });
    assert.equal(page.api.eligibleArrivalEntry(page.entry), true, referrer);
  }
});

test('reload is a new eligible document; history restore, discarded and prerender documents skip', () => {
  const reload = fixture({ navigationType: 'reload' });
  assert.equal(reload.api.eligibleArrivalEntry(reload.entry), true);
  for (const options of [{ navigationType: 'back_forward' }, { navigationType: 'unknown' }, { noNavigation: true }, { discarded: true }, { prerendering: true }]) {
    const page = fixture(options); page.mount(); page.assertClosed();
    assert.equal(page.api.eligibleArrivalEntry(page.entry), false);
  }
});

test('capture is stable within a document and fail-open without browser timing', () => {
  const page = fixture();
  assert.equal(page.api.captureArrivalDocument(), page.entry);
  page.navigate('/my-nights?welcome=1');
  assert.equal(page.api.captureArrivalDocument(), page.entry);
  assert.equal(page.entry.href, `${origin}/events`);
  const unavailable = fixture({ performanceFailure: true });
  assert.equal(unavailable.entry, null); unavailable.mount(); unavailable.assertClosed();
  page.context.document = undefined;
  assert.equal(page.api.captureArrivalDocument(), null);
});

test('each fresh document gets its own opportunity without a persistent suppression flag', () => {
  const page = fixture(); page.mount(); page.frame(); page.advance(2000);
  assert.equal(page.entry.phase, 'done');
  // Keep the actual module alive but change the browser-document identity.
  page.context.document = { ...page.document };
  const next = page.api.captureArrivalDocument();
  assert.notEqual(next, page.entry); assert.equal(next.phase, 'new');
  assert.equal(page.api.captureArrivalDocument(), next);
});

test('delayed JavaScript and input/scroll before module evaluation never cover a usable page', () => {
  for (const options of [{ now: 1501 }, { firstInput: true }, { scrollY: 20 }]) {
    const page = fixture(options); page.mount(); page.frame();
    page.assertClosed(); assert.equal(page.shows.length, 0);
  }
});

for (const interaction of ['first-input', 'scroll']) {
  test(`${interaction} between document capture and hydration prevents arrival`, () => {
    const options = {};
    const page = fixture(options);
    assert.equal(page.entry.interacted, false);
    page.advance(200);
    if (interaction === 'first-input') options.firstInput = true;
    else page.window.scrollY = 120;
    page.mount(); page.frame();
    page.assertClosed(); assert.equal(page.shows.length, 0);
    assert.equal(page.entry.phase, 'done');
  });

  test(`${interaction} after mounting is checked again before the emblem reveals`, () => {
    const options = { cached: false };
    const page = fixture(options); page.mount();
    if (interaction === 'first-input') options.firstInput = true;
    else page.window.scrollY = 120;
    page.load(); page.frame();
    page.assertClosed(); assert.equal(page.shows.length, 0);
    assert.equal(page.entry.phase, 'done');
  });
}

test('interaction timing failure after capture or mount remains fail-open', () => {
  for (const mounted of [false, true]) {
    const options = { cached: false };
    const page = fixture(options);
    if (mounted) page.mount();
    options.performanceFailure = true;
    if (!mounted) page.mount();
    else page.load();
    page.frame(); page.assertClosed(); assert.equal(page.shows.length, 0);
    assert.equal(page.entry.phase, 'done');
  }
});

test('malformed URL or referrer data fails closed without changing the real page', () => {
  const page = fixture();
  for (const override of [{ href: 'not a URL' }, { navigationHref: '%' }, { referrer: 'invalid referrer' }]) {
    assert.equal(page.api.eligibleArrivalEntry({ ...page.entry, ...override }), false);
  }
});

test('normal arrival becomes visible only after a ready image and ends at its hard deadline', () => {
  const page = fixture({ cached: false }); page.mount();
  assert.equal(page.root.hidden, true); assert.equal(page.entry.phase, 'pending');
  page.frame(); assert.equal(page.shows.length, 0);
  page.load(); page.frame();
  assert.equal(page.root.hidden, false); assert.equal(page.attributes.has('data-running'), true); assert.equal(page.entry.phase, 'shown');
  assert.equal(page.shows.length, 1); assert.ok(Number(page.style.get('--brand-arrival-exit-scale')) > 1);
  // No further RAF is delivered: the independent timer still fails open.
  page.advance(1999); assert.equal(page.root.hidden, false);
  page.advance(1); page.assertClosed(); assert.equal(page.entry.phase, 'done');
  page.mount(); page.frame(); assert.equal(page.shows.length, 1); page.assertClosed();
});

test('the animation frame deadline also removes an arrival when its timer is unavailable', () => {
  const page = fixture(); page.mount(); page.frame();
  assert.equal(page.root.hidden, false);
  page.timers.clear(); page.frame(2000); page.assertClosed();
  assert.equal(page.entry.phase, 'done');
});

test('StrictMode pending setup-cleanup-setup starts exactly once and invalidates stale work', () => {
  const page = fixture({ cached: false }); const firstCleanup = page.mount();
  const staleFrame = page.takeFrame(), staleLoad = page.images[0].onload;
  firstCleanup(); page.assertClosed(); assert.equal(page.entry.phase, 'new');
  page.mount(); staleFrame(); staleLoad(); firstCleanup();
  assert.equal(page.root.hidden, true); assert.equal(page.entry.phase, 'pending');
  page.load(); page.frame(); assert.equal(page.shows.length, 1);
  page.unmount(); page.assertClosed(); assert.equal(page.entry.phase, 'done');
  page.mount(); page.frame(); page.assertClosed(); assert.equal(page.shows.length, 1);
});

test('an excluded document cannot gain eligibility through client navigation or later remount', () => {
  const page = fixture({ path: '/payment/return' }); page.mount(); page.navigate('/events');
  page.mount(); page.frame(); page.assertClosed(); assert.equal(page.shows.length, 0);
});

for (const state of ['pending', 'shown']) {
  test(`route change closes ${state} arrival and prevents replay`, () => {
    const page = fixture({ cached: state === 'shown' }); page.mount();
    if (state === 'shown') page.frame();
    page.navigate('/event/one'); page.frame(); page.assertClosed();
    page.navigate('/events'); page.mount(); page.frame(); page.assertClosed();
    assert.equal(page.shows.length, state === 'shown' ? 1 : 0);
  });
}

test('a changed current URL or late mount cannot start an old document entry', () => {
  const navigation = fixture(); navigation.navigate('/event/one'); navigation.mount(); navigation.assertClosed();
  const delayed = fixture(); delayed.advance(501); delayed.mount(); delayed.assertClosed();
});

for (const options of [{ hidden: true }, { reducedMotion: true }, { cssReady: false }, { cssFailure: true }, { motionFailure: true }, { imageFailure: true }]) {
  test(`startup failure/preference is fail-open: ${JSON.stringify(options)}`, () => {
    const page = fixture(options); page.mount(); page.frame(); page.assertClosed(); assert.equal(page.shows.length, 0);
  });
}

test('missing image, image error and failed reveal never leave an overlay', () => {
  const slow = fixture({ cached: false }); slow.mount(); slow.advance(500); slow.assertClosed();
  slow.load(); slow.frame(); assert.equal(slow.shows.length, 0);
  const broken = fixture({ cached: false }); broken.mount(); broken.failImage(); broken.assertClosed();
  const reveal = fixture({ styleFailure: true }); reveal.mount(); reveal.frame(); reveal.assertClosed();
  assert.equal(reveal.shows.length, 0);
});

for (const type of ['keydown', 'wheel', 'pointerdown']) {
  test(`early ${type} cancels pending work without swallowing the underlying action`, () => {
    const page = fixture({ cached: false }); page.mount();
    const staleFrame = page.takeFrame(), staleLoad = page.images[0].onload;
    const event = page.document.dispatch(type, { target: {} });
    assert.equal(event.defaultPrevented, false); page.assertClosed();
    staleLoad(); staleFrame(); page.mount(); page.frame(); page.assertClosed(); assert.equal(page.shows.length, 0);
  });
}

test('pointer dismissal cannot click through, while Skip click and keyboard dismiss synchronously', () => {
  for (const action of ['pointer', 'skip', 'keyboard']) {
    const page = fixture(); page.mount(); page.frame(); assert.equal(page.root.hidden, false);
    const event = action === 'pointer' ? page.document.dispatch('pointerdown', { target: page.skip })
      : action === 'skip' ? page.root.dispatch('click', { target: page.skip })
      : page.document.dispatch('keydown', { key: 'Escape', target: page.skip });
    if (action !== 'keyboard') { assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true); }
    assert.equal(page.root.hidden, true);
    if (action === 'pointer') {
      page.window.dispatch('pointerup');
      page.window.dispatch('click', { detail: 1 });
    }
    page.assertClosed(); assert.equal(page.entry.phase, 'done');
  }
});

for (const pointerType of ['mouse', 'touch', 'pen']) {
  test(`${pointerType} dismissal suppresses its up and synthesized click after the scene hides`, () => {
    const page = fixture(); page.mount(); page.frame();
    const down = page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType });
    assert.equal(down.defaultPrevented, true); assert.equal(page.root.hidden, true);
    const up = page.window.dispatch('pointerup', { target: {}, pointerId: 7, pointerType });
    assert.equal(up.defaultPrevented, true); assert.equal(up.immediatePropagationStopped, true);
    if (pointerType === 'touch') {
      const end = page.window.dispatch('touchend', { target: {}, touches: [] });
      assert.equal(end.defaultPrevented, true); assert.equal(end.immediatePropagationStopped, true);
      const [listener] = page.window.listeners.get('touchend');
      assert.equal(listener.capture.capture, true); assert.equal(listener.capture.passive, false);
    }
    const click = page.window.dispatch('click', { target: {}, pointerId: 7, pointerType, detail: 1 });
    assert.equal(click.defaultPrevented, true); assert.equal(click.immediatePropagationStopped, true);
    page.assertClosed();
    assert.equal(page.window.dispatch('click', { detail: 1 }).defaultPrevented, false);
  });
}

test('a long-held dismissal still owns its legacy touch click after the visual deadline', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType: 'touch' });
  page.advance(3000); assert.equal(page.root.hidden, true);
  page.window.dispatch('pointerup', { pointerId: 7 });
  page.window.dispatch('touchend'); page.advance(300);
  const click = page.window.dispatch('click', { detail: 1 });
  assert.equal(click.defaultPrevented, true); page.assertClosed();
});

test('touchend retains the guard through its delayed click even without pointerup', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType: 'touch' });
  assert.equal(page.window.dispatch('touchend', { touches: [] }).defaultPrevented, true);
  page.advance(300);
  assert.equal(page.window.dispatch('click', { detail: 1 }).defaultPrevented, true);
  page.assertClosed();
});

test('touch cancellation releases the guard without delaying a later tap', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType: 'touch' });
  page.window.dispatch('touchcancel', { touches: [] }); page.assertClosed();
  assert.equal(page.window.dispatch('click', { pointerId: 8, detail: 1 }).defaultPrevented, false);
});

test('another touch ending cannot cancel or expire a still-held dismissing gesture', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType: 'touch' });
  assert.equal(page.window.dispatch('touchend', { touches: [{}] }).defaultPrevented, false);
  page.window.dispatch('touchcancel', { touches: [{}] }); page.advance(3000);
  page.window.dispatch('pointerup', { pointerId: 7 });
  assert.equal(page.window.dispatch('click', { detail: 1 }).defaultPrevented, true);
  page.assertClosed();
});

test('another pointer cannot end the dismissing gesture guard', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7 });
  assert.equal(page.window.dispatch('pointerup', { pointerId: 8 }).defaultPrevented, false);
  page.window.dispatch('pointercancel', { pointerId: 8 }); page.advance(3000);
  assert.equal(page.window.dispatch('click', { pointerId: 8, detail: 1 }).defaultPrevented, false);
  page.window.dispatch('pointerup', { pointerId: 7 });
  assert.equal(page.window.dispatch('click', { pointerId: 7, detail: 1 }).defaultPrevented, true);
  page.assertClosed();
});

for (const next of ['pointerdown', 'keydown', 'pointercancel']) {
  test(`${next} releases the old gesture without swallowing a later intentional action`, () => {
    const page = fixture(); page.mount(); page.frame();
    page.document.dispatch('pointerdown', { target: page.root, pointerId: 7 });
    page.window.dispatch(next, { pointerId: next === 'pointerdown' ? 8 : 7 });
    page.assertClosed();
    assert.equal(page.window.dispatch('pointerup', { pointerId: 8 }).defaultPrevented, false);
    assert.equal(page.window.dispatch('click', { pointerId: 8, detail: 1 }).defaultPrevented, false);
  });
}

test('keyboard or assistive clicks are not mistaken for the dismissing pointer click', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7 });
  assert.equal(page.window.dispatch('click', { detail: 0 }).defaultPrevented, false);
  page.window.dispatch('pointerup', { pointerId: 7 });
  assert.equal(page.window.dispatch('click', { pointerId: 7, detail: 1 }).defaultPrevented, true);
  page.assertClosed();
});

test('a completed pointer with no click releases the guard after a bounded fallback', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7 });
  page.window.dispatch('pointerup', { pointerId: 7 });
  page.advance(500); page.assertClosed();
  assert.equal(page.window.dispatch('click', { detail: 1 }).defaultPrevented, false);
});

test('a completed touch with no compatibility click releases every listener', () => {
  const page = fixture(); page.mount(); page.frame();
  page.document.dispatch('pointerdown', { target: page.root, pointerId: 7, pointerType: 'touch' });
  page.window.dispatch('pointerup', { pointerId: 7 });
  page.window.dispatch('touchend', { touches: [] });
  page.advance(499); assert.ok(page.listeners > 0);
  page.advance(1); page.assertClosed();
});

for (const end of ['unmount', 'pagehide', 'hidden']) {
  test(`${end} also removes the separate dismissing gesture guard`, () => {
    const page = fixture(); page.mount(); page.frame();
    page.document.dispatch('pointerdown', { target: page.root, pointerId: 7 });
    if (end === 'unmount') page.unmount();
    else if (end === 'hidden') page.hide();
    else page.window.dispatch('pagehide');
    page.assertClosed();
  });
}

for (const state of ['pending', 'shown']) {
  for (const reason of ['hidden', 'motion', 'pagehide', 'bfcache', 'popstate', 'hashchange']) {
    test(`${reason} ends ${state} arrival permanently, with all resources released`, () => {
      const page = fixture({ cached: state === 'shown' }); page.mount(); if (state === 'shown') page.frame();
      if (reason === 'hidden') page.hide();
      else if (reason === 'motion') page.reduce();
      else page.window.dispatch(reason === 'bfcache' ? 'pageshow' : reason, { persisted: reason === 'bfcache' });
      page.assertClosed(); assert.equal(page.entry.phase, 'done');
      page.hide(false); page.reduce(false); page.window.dispatch('focus'); page.window.dispatch('pageshow', { persisted: false });
      page.mount(); page.frame(); page.assertClosed(); assert.equal(page.shows.length, state === 'shown' ? 1 : 0);
    });
  }
}

test('initial pageshow/focus do not restart or cancel an ordinary active arrival', () => {
  const page = fixture(); page.mount(); page.frame();
  page.window.dispatch('pageshow', { persisted: false }); page.window.dispatch('focus');
  assert.equal(page.root.hidden, false); assert.equal(page.shows.length, 1);
  page.unmount(); page.assertClosed();
});

test('unmount invalidates a dequeued callback and a second cleanup cannot harm a newer mount', () => {
  const page = fixture({ cached: false }); const oldCleanup = page.mount();
  const staleFrame = page.takeFrame(), staleLoad = page.images[0].onload;
  oldCleanup(); page.assertClosed(); page.mount(); oldCleanup(); staleLoad(); staleFrame();
  assert.equal(page.entry.phase, 'pending'); assert.equal(page.root.hidden, true);
  page.load(); page.frame(); assert.equal(page.shows.length, 1);
  const shownFrame = page.takeFrame(); page.unmount(); shownFrame(); page.assertClosed();
});

test('SSR, missing JavaScript and reduced-motion CSS preserve an immediately usable page', async () => {
  const markup = await readFile(new URL('../app/brand-arrival.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/brand-arrival.css', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  const native = await readFile(new URL('../mobile/src/main.tsx', import.meta.url), 'utf8');
  assert.match(markup, /className="brand-arrival" hidden/);
  assert.match(css, /\.brand-arrival\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /0%,\s*99\.999%\s*\{\s*visibility:\s*visible;\s*pointer-events:\s*auto;/);
  assert.match(css, /100%\s*\{\s*visibility:\s*hidden;\s*pointer-events:\s*none;/);
  assert.match(layout, /<BrandArrival\s*\/>/); assert.doesNotMatch(native, /BrandArrival|brand-arrival/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.body\.(?:style|inert)/);
});


test('actual server markup keeps the scene hidden without JavaScript', () => {
  const result = buildSync({ entryPoints: [fileURLToPath(new URL('../app/brand-arrival.tsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
  const component = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module: component, exports: component.exports, require: createRequire(import.meta.url) });
  const markup = renderToStaticMarkup(createElement(component.exports.default));
  assert.match(markup, /<div[^>]*class="brand-arrival"[^>]*hidden=""/);
  assert.doesNotMatch(markup, /data-running|<video|<audio/);
  assert.match(markup, /href="\/brand\/becore-ticket\.webp"/);
  assert.match(markup, /aria-label="Skip opening animation"/);
});
