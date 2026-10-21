import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [formSource, dockSource, hookSource, roomSource] = await Promise.all([
  read('app/registration-form.tsx'), read('app/customer-dock.tsx'), read('app/use-room-updates.ts'), read('app/room/[slug]/room-client.tsx'),
]);
const compile = source => transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function clockFor(window) {
  let id = 0, now = 0;
  const pending = new Map();
  window.setTimeout = (fn, delay) => { pending.set(++id, { fn, at: now + delay, delay, interval: false }); return id; };
  window.setInterval = (fn, delay) => { pending.set(++id, { fn, at: now + delay, delay, interval: true }); return id; };
  window.clearTimeout = window.clearInterval = id => pending.delete(id);
  return { pending, async advance(ms) {
    const until = now + ms;
    while (true) {
      const next = [...pending].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at;
      if (timer.interval) timer.at += timer.delay; else pending.delete(id);
      timer.fn(); await flush();
    }
    now = until;
  } };
}
function registration(mode = 'rsvp') {
  const window = new EventTarget(); window.location = { search: '' };
  let emitted = 0; const requests = [];
  window.addEventListener('bct:attendee-session-changed', () => emitted++);
  const handler = formSource.slice(formSource.indexOf('  async function submit('), formSource.indexOf('  return <section className="registration-form">'));
  const submit = runInNewContext(compile(handler + '\nsubmit;'), {
    window, Event, ready: true, inFlight: { current: false }, eventSlug: 'fixture', mode, URLSearchParams,
    FormData: class { get(key) { return ({ email: 'fixture@example.invalid', guestName: 'Fixture Guest', acceptedTerms: 'on' })[key] ?? null; } },
    fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    setBusy() {}, setMessage() {}, setPlatformOptIn() {}, setCanManage() {}, setSent() {}, registrationDrafts: { clear() {} },
  });
  return { get emitted() { return emitted; }, requests, submit: () => submit({ preventDefault() {}, currentTarget: {} }) };
}
test('manageable RSVP emits session invalidation once, only after successful response, despite duplicate submit', async () => {
  const form = registration(); const first = form.submit(); await form.submit();
  assert.equal(form.requests.length, 1); assert.equal(form.emitted, 0);
  form.requests[0].resolve({ ok: true, json: async () => ({ canManage: true, message: 'Saved' }) }); await first;
  assert.equal(form.emitted, 1);
});
for (const [mode, ok, canManage] of [['rsvp', true, false], ['rsvp', false, true], ['interest', true, true]]) {
  test(`${mode}, ok=${ok}, canManage=${canManage} does not announce new attendee access`, async () => {
    const form = registration(mode), saved = form.submit();
    form.requests[0].resolve({ ok, json: async () => ({ canManage, message: 'Saved' }) }); await saved;
    assert.equal(form.emitted, 0);
  });
}
test('failed RSVP transport does not announce new attendee access', async () => {
  const form = registration(), saved = form.submit(); form.requests[0].reject(new Error('Offline')); await saved;
  assert.equal(form.emitted, 0);
});

function mountResponsiveUpdates() {
  const window = new EventTarget(), document = new EventTarget(), media = new EventTarget();
  media.matches = false; document.visibilityState = 'visible';
  window.matchMedia = query => { assert.equal(query, '(max-width: 700px)'); return media; };
  const clock = clockFor(window), requests = [], slots = [], effects = new Map();
  const viewportSource = dockSource.slice(dockSource.indexOf('const dockMediaQuery'), dockSource.indexOf('export default function CustomerDock'));
  const viewport = runInNewContext(compile(viewportSource + '\n({ subscribeToDockViewport, dockIsVisible, serverDockIsVisible });'), { window });
  let cursor = 0, api, enabled = false;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn, dependencies, evaluate) => {
    const index = cursor++;
    if (!equal(slots[index]?.dependencies, dependencies)) slots[index] = { value: evaluate ? fn() : fn, dependencies };
    return slots[index].value;
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; const state = slots[index] ??= { value }; return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }]; },
    useCallback: (fn, deps) => memo(fn, deps, false), useMemo: (fn, deps) => memo(fn, deps, true),
    useEffect(setup, dependencies) { const index = cursor++; if (!equal(slots[index]?.dependencies, dependencies)) effects.set(index, { setup, dependencies }); },
  };
  const component = { exports: {} };
  runInNewContext(compile(hookSource), { module: component, exports: component.exports, window, document, AbortController, Date,
    require(name) {
      if (name === 'react') return react;
      if (name === '../lib/client-request') return { requestJson: (_url, init) => new Promise(resolve => requests.push({ resolve, signal: init.signal })) };
      throw new Error(name);
    },
  });
  const render = () => {
    cursor = 0; effects.clear(); api = component.exports.useRoomUpdates(enabled, '/events');
    for (const index of effects.keys()) slots[index]?.cleanup?.();
    for (const [index, effect] of effects) slots[index] = { ...effect, cleanup: effect.setup() };
  };
  const unsubscribe = viewport.subscribeToDockViewport(() => { enabled = viewport.dockIsVisible(); render(); });
  render();
  return { get api() { return api; }, clock, requests, render, viewport,
    resize(width) { const matches = width <= 700; if (matches !== media.matches) { media.matches = matches; media.dispatchEvent(new Event('change')); } },
    unmount() { unsubscribe(); for (const slot of slots) slot?.cleanup?.(); },
  };
}
test('CSS-hidden desktop dock does not fetch or poll; breakpoint entry refreshes without reviving cached Rooms', async () => {
  assert.match(dockSource, /useSyncExternalStore\(subscribeToDockViewport, dockIsVisible, serverDockIsVisible\)/u);
  assert.match(dockSource, /useRoomUpdates\(!hidden && dockVisible, pathname\)/u);
  const hook = mountResponsiveUpdates(); assert.equal(hook.viewport.serverDockIsVisible(), false);
  await hook.clock.advance(120_000); assert.equal(hook.requests.length, 0);
  hook.resize(700); await hook.clock.advance(0); assert.equal(hook.requests.length, 1);
  hook.requests[0].resolve({ rooms: [{ eventSlug: 'fixture', title: 'Fixture', unread: 2, expiresAt: new Date(Date.now() + 3600_000).toISOString() }] });
  await flush(); hook.render(); assert.equal(hook.api.rooms.length, 1);
  await hook.clock.advance(30_000); assert.equal(hook.requests.length, 2);
  hook.resize(701); assert.equal(hook.api.rooms.length, 0); assert.equal(hook.requests[1].signal.aborted, true);
  await hook.clock.advance(120_000); assert.equal(hook.requests.length, 2);
  hook.resize(700); assert.equal(hook.api.rooms.length, 0); await hook.clock.advance(0); assert.equal(hook.requests.length, 3);
  hook.unmount(); hook.resize(701); hook.resize(700); await hook.clock.advance(120_000); assert.equal(hook.requests.length, 3);
});

class RequestError extends Error { constructor(status) { super('Fixture failure'); this.status = status; } }
function mountAcknowledgement() {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = 'visible';
  const clock = clockFor(window), requests = [], cleanups = [];
  let accessAttempts = 0, notifications = 0;
  window.addEventListener('bct:room-updates-read', () => notifications++);
  const declarations = roomSource.slice(roomSource.indexOf('  const updateSnapshotRef ='), roomSource.indexOf('  const openedAnnouncement ='));
  const effectStart = roomSource.indexOf('  useEffect(() => {\n    // Effects run after');
  const effect = roomSource.slice(effectStart, roomSource.indexOf('  useEffect(() => {', effectStart + 10));
  const socketRef = { current: { readyState: 1 } };
  const environment = {
    window, document, Event, AbortController, RequestError, WebSocket: { OPEN: 1 }, socketRef, leavingRef: { current: false },
    slug: 'fixture', status: 'connected', messages: [], useRef: value => ({ current: value }), useCallback: fn => fn,
    useEffect: setup => { cleanups.push(setup()); }, setAccessAttempt: update => { accessAttempts = update(accessAttempts); },
    requestJson: (url, init) => new Promise((resolve, reject) => requests.push({ url, ...init, resolve, reject })),
  };
  const api = runInNewContext(compile(declarations + '\nfunction renderEffect() {\n' + effect + '\n}\nrenderEffect();\n({ acknowledgeVisibleUpdates, updateSnapshotRef, roomSnapshotReadyRef, updateAcknowledgmentRetryRef, renderEffect });'), environment);
  api.updateSnapshotRef.current = 'viewed-boundary'; api.roomSnapshotReadyRef.current = true;
  return { ...api, clock, requests, get accessAttempts() { return accessAttempts; }, get notifications() { return notifications; },
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); },
    connection(status, readyState) { cleanups.pop()?.(); environment.status = status; socketRef.current.readyState = readyState; api.renderEffect(); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}
for (const status of [null, 408, 429, 503]) {
  test(`transient ${status ?? 'network'} acknowledgement retries at 1/2/4s, stays on its viewed boundary and stops`, async () => {
    const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates();
    for (const delay of [1000, 2000, 4000]) {
      const count = ack.requests.length; ack.requests.at(-1).reject(new RequestError(status)); await flush();
      // Message arrivals or unrelated renders must not defeat backoff or capture a newer boundary.
      await ack.acknowledgeVisibleUpdates(); assert.equal(ack.requests.length, count);
      await ack.clock.advance(delay - 1); assert.equal(ack.requests.length, count);
      await ack.clock.advance(1); assert.equal(ack.requests.length, count + 1);
    }
    ack.requests.at(-1).reject(new RequestError(status)); await flush(); await ack.clock.advance(60_000);
    // Neither Room message/reaction churn nor repeated foregrounding resets the budget.
    for (let i = 0; i < 5; i++) { await ack.acknowledgeVisibleUpdates(); ack.visibility('hidden'); ack.visibility('visible'); }
    assert.equal(ack.requests.length, 4); assert.equal(ack.accessAttempts, 0); assert.equal(ack.notifications, 0);
    assert.equal(ack.updateSnapshotRef.current, 'viewed-boundary');
    for (const request of ack.requests) assert.deepEqual(JSON.parse(request.body), { snapshot: 'viewed-boundary' });
    ack.unmount();
  });
}
test('successful acknowledgement retry clears only its snapshot and notifies once', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates(); ack.requests[0].reject(new RequestError(503)); await flush();
  await ack.clock.advance(1000); ack.requests[1].resolve({ updated: true }); await flush(); await ack.clock.advance(60_000);
  await ack.acknowledgeVisibleUpdates(); assert.equal(ack.requests.length, 2); assert.equal(ack.notifications, 1); assert.equal(ack.updateSnapshotRef.current, null);
  ack.unmount();
});
test('fresh authorized snapshots receive a new retry budget after the previous one is exhausted', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates();
  for (const delay of [1000, 2000, 4000]) { ack.requests.at(-1).reject(new RequestError(503)); await flush(); await ack.clock.advance(delay); }
  ack.requests.at(-1).reject(new RequestError(503)); await flush();
  ack.updateSnapshotRef.current = 'fresh-boundary'; void ack.acknowledgeVisibleUpdates();
  assert.equal(ack.requests.length, 5); assert.deepEqual(JSON.parse(ack.requests[4].body), { snapshot: 'fresh-boundary' });
  assert.equal(ack.updateAcknowledgmentRetryRef.current.attempts, 1); ack.unmount();
});
test('disconnect cancels retry and reconnect waits for a rendered snapshot without resetting its budget', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates(); ack.requests[0].reject(new RequestError(503)); await flush();
  ack.connection('offline', 3); await ack.clock.advance(60_000); assert.equal(ack.requests.length, 1);
  ack.roomSnapshotReadyRef.current = false; ack.connection('connecting', 0); ack.connection('connected', 1);
  assert.equal(ack.requests.length, 1); ack.roomSnapshotReadyRef.current = true; void ack.acknowledgeVisibleUpdates();
  assert.equal(ack.requests.length, 2); assert.equal(ack.updateAcknowledgmentRetryRef.current.attempts, 2); ack.unmount();
});
test('an obsolete failed acknowledgement cannot retry or replace a newer access boundary', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates();
  ack.updateSnapshotRef.current = 'newer-boundary'; ack.requests[0].reject(new RequestError(503)); await flush();
  await ack.clock.advance(60_000); assert.equal(ack.requests.length, 1); assert.equal(ack.updateSnapshotRef.current, 'newer-boundary');
  assert.equal(ack.accessAttempts, 0); assert.equal(ack.notifications, 0); ack.unmount();
});
test('successful acknowledgement of the old boundary leaves newer arrivals unread', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates();
  ack.updateSnapshotRef.current = 'newer-boundary'; ack.requests[0].resolve({ updated: true }); await flush();
  assert.deepEqual(JSON.parse(ack.requests[0].body), { snapshot: 'viewed-boundary' });
  assert.equal(ack.updateSnapshotRef.current, 'newer-boundary'); assert.equal(ack.notifications, 1); ack.unmount();
});
for (const action of ['hidden', 'unmount']) {
  test(`${action} cancels a scheduled acknowledgement retry`, async () => {
    const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates(); ack.requests[0].reject(new RequestError(503)); await flush();
    if (action === 'hidden') ack.visibility('hidden'); else ack.unmount();
    await ack.clock.advance(60_000); assert.equal(ack.requests.length, 1); assert.equal(ack.clock.pending.size, 0);
    if (action === 'hidden') { ack.visibility('visible'); assert.equal(ack.requests.length, 2); ack.unmount(); }
  });
  test(`${action} aborts an in-flight acknowledgement without scheduling a late retry`, async () => {
    const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates();
    if (action === 'hidden') ack.visibility('hidden'); else ack.unmount();
    assert.equal(ack.requests[0].signal.aborted, true); ack.requests[0].reject(new RequestError(null)); await flush(); await ack.clock.advance(60_000);
    assert.equal(ack.requests.length, 1); assert.equal(ack.notifications, 0); assert.equal(ack.updateSnapshotRef.current, 'viewed-boundary'); ack.unmount();
  });
}
test('expired boundaries still require fresh access and a rendered snapshot, with only one recovery cycle', async () => {
  const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates(); ack.requests[0].reject(new RequestError(400)); await flush();
  assert.equal(ack.accessAttempts, 1); assert.equal(ack.updateSnapshotRef.current, null); assert.equal(ack.roomSnapshotReadyRef.current, false);
  await ack.clock.advance(60_000); assert.equal(ack.requests.length, 1);
  ack.updateSnapshotRef.current = 'fresh-boundary'; await ack.acknowledgeVisibleUpdates(); assert.equal(ack.requests.length, 1);
  ack.roomSnapshotReadyRef.current = true; void ack.acknowledgeVisibleUpdates(); assert.equal(ack.requests.length, 2);
  assert.deepEqual(JSON.parse(ack.requests[1].body), { snapshot: 'fresh-boundary' });
  ack.requests[1].reject(new RequestError(400)); await flush(); await ack.acknowledgeVisibleUpdates(); ack.visibility('visible');
  assert.equal(ack.requests.length, 2); assert.equal(ack.accessAttempts, 1); assert.equal(ack.clock.pending.size, 0); ack.unmount();
});
for (const status of [401, 403, 404]) {
  test(`non-transient ${status} acknowledgement does not retry`, async () => {
    const ack = mountAcknowledgement(); void ack.acknowledgeVisibleUpdates(); ack.requests[0].reject(new RequestError(status)); await flush();
    await ack.clock.advance(60_000); await ack.acknowledgeVisibleUpdates(); ack.visibility('visible');
    assert.equal(ack.requests.length, 1); assert.equal(ack.accessAttempts, 0); ack.unmount();
  });
}
