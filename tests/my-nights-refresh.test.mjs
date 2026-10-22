import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const compile = async path => transformSync(await readFile(new URL(path, import.meta.url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;
const feedCode = await compile('../app/my-nights/my-nights-client.tsx');
const registrationsCode = await compile('../app/my-registrations.tsx');
const pending = { id: 'rsvp', eventSlug: 'approval-fixture', title: 'Approval fixture', kind: 'rsvp', status: 'requested', partySize: 1, maxPartySize: 2, mode: 'rsvp', roomAccess: 1 };
const confirmed = { ...pending, status: 'confirmed' };
const night = { ...pending, purchased: true, admissionActive: true, registrationMode: 'rsvp', roomAccess: true, ticketCount: 1, startsAt: '2026-11-01T19:00:00Z', endsAt: '2026-11-02T02:00:00Z', venue: 'Fixture venue', area: '', imageUrl: '/fixture.webp', eventState: 'on_sale', keepPosted: false };
const snapshot = (nights = []) => ({ attendee: { displayName: 'Guest' }, nights });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

// The real components/effects run together, with deterministic time and requests.
// In-flight requests can finish after abort to exercise stale-result protection.
function mountNights({ query = '', ready = true } = {}) {
  const components = new Map(), timers = new Map(), calls = [];
  const document = new EventTarget(), window = new EventTarget(), navigator = { onLine: true };
  document.hidden = false;
  let current, cursor, tree, registrationTree, dirty = false, mounted = true, updatesAfterUnmount = 0;
  let now = Date.parse('2026-10-19T12:00:00Z'), timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useSyncExternalStore() { return ready; },
    useRef(value) { return current.slots[cursor++] ??= { current: value }; },
    useState(initial) {
      const state = current.slots[cursor++] ??= { value: initial };
      state.set ??= value => {
        if (!mounted) updatesAfterUnmount++;
        const next = typeof value === 'function' ? value(state.value) : value;
        if (!Object.is(next, state.value)) { state.value = next; dirty = true; }
      };
      return [state.value, state.set];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!same(current.slots[index]?.dependencies, dependencies)) current.slots[index] = { callback, dependencies };
      return current.slots[index].callback;
    },
    useMemo(callback, dependencies) { return react.useCallback(callback, dependencies)(); },
    useEffect(setup, dependencies) {
      const index = cursor++;
      if (!same(current.slots[index]?.dependencies, dependencies)) current.effects.set(index, { setup, dependencies });
    },
  };
  const setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
  window.setTimeout = setTimeout;
  window.clearTimeout = id => timers.delete(id);
  const request = (url, init = {}, raw = false) => new Promise((resolve, reject) => calls.push({ url, init, reject,
    respond(data, status = 200) { resolve(raw ? { ok: status < 400, status, json: async () => data } : data); },
  }));
  class RequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const jsx = (type, props) => ({ type, props });
  function load(code) {
    const componentModule = { exports: {} };
    runInNewContext(code, {
      module: componentModule, exports: componentModule.exports, document, window, navigator, AbortController,
      Date: class extends Date { static now() { return now; } },
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      fetch: (url, init) => request(url, init, true),
      require(specifier) {
        if (specifier === 'react') return react;
        if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (specifier === 'next/navigation') return { useSearchParams: () => new URLSearchParams(query) };
        if (specifier === 'next/link') return { __esModule: true, default: 'a' };
        if (specifier === 'lucide-react') return new Proxy({}, { get: (_, name) => name });
        if (specifier.endsWith('/client-request')) return { requestJson: request, RequestError, requestErrorMessage: error => error.message };
        if (specifier.endsWith('/use-current-time')) return { useCurrentTime: () => now };
        if (specifier.endsWith('/action')) return { ActionButton: 'button', ActionLink: 'a' };
        if (specifier.endsWith('/my-registrations')) return { __esModule: true, default: 'MyRegistrations' };
        return { __esModule: true, default: specifier };
      },
    });
    return componentModule.exports.default;
  }
  const Feed = load(feedCode), Registrations = load(registrationsCode);
  function render(name, component, props) {
    current = components.get(name);
    if (!current) { current = { slots: [], effects: new Map() }; components.set(name, current); }
    cursor = 0;
    return component(props);
  }
  function commit() {
    if (!mounted) return;
    let renders = 0;
    do {
      assert.ok(++renders < 20, 'effects must converge');
      dirty = false;
      tree = render('feed', Feed);
      const registrations = nodes(tree).find(node => node.type === 'MyRegistrations');
      if (registrations) registrationTree = render('registrations', Registrations, registrations.props);
      for (const frame of components.values()) {
        for (const [index, effect] of frame.effects) {
          frame.slots[index]?.cleanup?.(); frame.slots[index] = effect;
          effect.cleanup = effect.setup();
        }
        frame.effects.clear();
      }
    } while (dirty);
  }
  const flush = async () => { await new Promise(setImmediate); commit(); };
  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
    }
    now = target; await flush();
  }
  commit();
  return {
    flush, advance, calls,
    setReady(value) { ready = value; commit(); },
    get recoveryInput() { return nodes(tree).find(node => node.type === 'input' && node.props.type === 'email'); },
    get recoverySubmit() { return nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit'); },
    get recoveryForm() { return nodes(tree).find(node => node.type === 'form' && node.props.className === 'my-nights-recovery'); },
    async fillRecovery(value) { this.recoveryInput.props.onChange({ target: { value } }); await flush(); },
    submitRecovery() { return this.recoveryForm.props.onSubmit({ preventDefault() {} }); },
    get feedCalls() { return calls.filter(call => call.url.endsWith('/my-nights')); },
    get registrationCalls() { return calls.filter(call => call.url.endsWith('/registrations')); },
    get text() { return text(tree); },
    get registrationText() { return text(registrationTree); },
    get links() { return nodes(tree).filter(node => node.type === 'a').map(node => node.props.href); },
    get timers() { return timers.size; },
    get listeners() { return getEventListeners(document, 'visibilitychange').length + getEventListeners(window, 'focus').length + getEventListeners(window, 'online').length; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    async focus() { window.dispatchEvent(new Event('focus')); await flush(); },
    async hide(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); await flush(); },
    async online(value) { navigator.onLine = value; window.dispatchEvent(new Event('online')); await flush(); },
    async initial(rows = [pending], nights = []) {
      await advance(0); calls[0].respond(snapshot(nights)); await flush(); await advance(0);
      this.registrationCalls[0].respond({ registrations: rows }); await flush();
    },
    unmount() { mounted = false; for (const frame of components.values()) for (const slot of frame.slots) slot?.cleanup?.(); },
  };
}

test('approval refreshes Upcoming passes and Room without changing the RSVP count', async () => {
  const page = mountNights();
  await page.initial();
  assert.equal(page.feedCalls.length, 1, 'pending registrations do not cause duplicate initial reads');
  assert.match(page.text, /Your next night is out there/);
  await page.advance(60_000);
  page.registrationCalls[1].respond({ registrations: [confirmed] }); await page.flush();
  assert.match(page.registrationText, /RSVP confirmed/);
  assert.equal(page.feedCalls.length, 2, 'a status-only change revalidates the parent feed');
  page.feedCalls[1].respond(snapshot([night])); await page.flush();
  assert.match(page.text, /Show my RSVP pass/);
  assert.ok(page.links.includes('/my-nights/approval-fixture?view=passes'));
  assert.ok(page.links.includes('/room/approval-fixture'));
  await page.advance(600_000);
  assert.equal(page.feedCalls.length, 2, 'settled nights add no background polling');
  assert.equal(page.registrationCalls.length, 2);
  page.unmount();
});

test('unchanged pending polls do not reload the parent feed', async () => {
  const page = mountNights(); await page.initial();
  await page.advance(60_000);
  page.registrationCalls[1].respond({ registrations: [{ ...pending, title: 'New title' }] }); await page.flush();
  assert.equal(page.feedCalls.length, 1);
  page.unmount();
});

test('a confirmed first snapshot repairs an approval that raced the initial feed', async () => {
  const page = mountNights(); await page.initial([confirmed]);
  assert.equal(page.feedCalls.length, 2);
  page.feedCalls[1].respond(snapshot([night])); await page.flush();
  assert.ok(page.links.includes('/room/approval-fixture'));
  page.unmount();
});

test('resume revalidates without overlapping reads, and entitlement changes supersede stale results', async () => {
  const page = mountNights(); await page.initial();
  await page.focus();
  const oldFeed = page.feedCalls[1];
  await page.focus(); await page.online(true);
  assert.equal(page.feedCalls.length, 2, 'resume events share the in-flight request');
  page.registrationCalls[1].respond({ registrations: [confirmed] }); await page.flush();
  assert.equal(oldFeed.init.signal.aborted, true);
  const latest = page.feedCalls[2];
  oldFeed.respond(snapshot()); await page.flush(); await page.focus();
  assert.equal(page.feedCalls.length, 3, 'an old finally must not clear the new request guard');
  latest.respond(snapshot([night])); await page.flush();
  assert.ok(page.links.includes('/room/approval-fixture'));
  await page.focus();
  assert.equal(page.feedCalls.length, 4, 'returning immediately must see approval received seconds after the last read');
  page.unmount();
});

test('focus and reconnect do no work while hidden or offline; returning refreshes', async () => {
  const page = mountNights(); await page.initial([]);
  await page.advance(30_000); await page.hide(true); await page.focus(); await page.online(false);
  assert.equal(page.feedCalls.length, 1);
  await page.hide(false); await page.focus();
  assert.equal(page.feedCalls.length, 1);
  await page.online(true);
  assert.equal(page.feedCalls.length, 2);
  page.feedCalls[1].respond(snapshot([night])); await page.flush();
  assert.ok(page.links.includes('/room/approval-fixture'));
  page.unmount();
});

test('unmount aborts both reads, removes resume listeners and ignores late responses', async () => {
  const page = mountNights(); await page.initial();
  await page.advance(30_000); await page.focus();
  const feed = page.feedCalls[1], registrations = page.registrationCalls[1];
  page.unmount();
  assert.equal(feed.init.signal.aborted, true);
  assert.equal(registrations.init.signal.aborted, true);
  assert.equal(page.listeners, 0);
  assert.equal(page.timers, 0);
  feed.respond(snapshot([night])); registrations.respond({ registrations: [confirmed] }); await page.flush();
  assert.equal(page.updatesAfterUnmount, 0);
});


test('explicit recovery remains available with a different valid session and sends nothing automatically', async () => {
  const page = mountNights({ query: 'recover=1' });
  assert.match(page.text, /Booking or registration email/);
  await page.initial([], [night]);
  assert.match(page.text, /Booking or registration email/);
  assert.doesNotMatch(page.text, /Show my RSVP pass/);
  assert.equal(page.calls.filter(call => call.init.method === 'POST').length, 0);
  page.unmount();
});

// Use real React server rendering, not the hook harness, to verify the initial
// HTML that can be interacted with before the client has attached its handlers.
test('explicit recovery server HTML disables entry and submission with accessible readiness feedback', () => {
  const componentModule = { exports: {} };
  const requireDependency = createRequire(import.meta.url);
  runInNewContext(feedCode, {
    module: componentModule, exports: componentModule.exports,
    require(specifier) {
      if (specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'lucide-react') return requireDependency(specifier);
      if (specifier === 'next/navigation') return { useSearchParams: () => new URLSearchParams('recover=1') };
      if (specifier === 'next/link') return { __esModule: true, default: ({ children, ...props }) => createElement('a', props, children) };
      if (specifier.endsWith('/use-current-time')) return { useCurrentTime: () => Date.parse('2026-10-19T12:00:00Z') };
      if (specifier.endsWith('/action')) return { ActionButton: ({ children, icon, ...props }) => createElement('button', props, children, icon) };
      return { __esModule: true, default: () => null };
    },
  });
  const html = renderToStaticMarkup(createElement(componentModule.exports.default));
  const form = html.match(/<form class="my-nights-recovery"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? '';
  assert.match(form, /<input[^>]*disabled=""/);
  assert.match(form, /<button[^>]*disabled=""/);
  assert.match(form, /aria-busy="true"/);
  assert.match(html, /role="status"[^>]*>Getting secure recovery ready/);
});

test('recovery becomes interactive only after readiness and does not post during hydration', async () => {
  const page = mountNights({ query: 'recover=1', ready: false });
  assert.equal(page.recoveryInput.props.disabled, true);
  assert.equal(page.recoverySubmit.props.disabled, true);
  await page.submitRecovery();
  assert.equal(page.calls.filter(call => call.init.method === 'POST').length, 0);
  page.setReady(true);
  assert.equal(page.recoveryInput.props.disabled, false);
  assert.equal(page.recoverySubmit.props.disabled, false);
  assert.doesNotMatch(page.text, /Getting secure recovery ready/);
  page.unmount();
});

test('early recovery entry survives initial authenticated feed and registration reads and submits once', async () => {
  const page = mountNights({ query: 'recover=1' });
  await page.fillRecovery('approved-guest@example.com');
  await page.initial([], [night]);
  assert.equal(page.recoveryInput.props.value, 'approved-guest@example.com');
  assert.equal(page.recoverySubmit.props.disabled, false);
  const sending = page.submitRecovery();
  await page.submitRecovery();
  await page.flush();
  const posts = page.calls.filter(call => call.init.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/customer/recovery');
  assert.deepEqual(JSON.parse(posts[0].init.body), { email: 'approved-guest@example.com' });
  assert.equal(page.recoverySubmit.props.disabled, true);
  posts[0].respond({ sent: true }); await sending; await page.flush();
  assert.match(page.text, /Check your email/);
  assert.equal(page.recoveryInput.props.value, 'approved-guest@example.com');
  assert.equal(page.recoverySubmit.props.disabled, true);
  assert.ok(page.calls.every(call => ['/api/customer/my-nights', '/api/customer/registrations', '/api/customer/recovery'].includes(call.url)));
  page.unmount();
});

const hubCode = await compile('../app/my-nights/[slug]/night-hub.tsx');
const hubEvent = { ...night, slug: night.eventSlug, fullDate: '1 November 2026', time: '19:00', image: '/fixture.webp', venueMapUrl: null, lineup: '', ageRestriction: '18+' };
const hubExperience = label => ({
  attendee: { displayName: `${label} guest` }, preference: { attendeeVisible: false, keepPosted: false },
  questions: [{ id: 'question', prompt: 'Arrival', kind: 'text', options: [], required: false, answer: `${label} answer` }],
  updates: [{ id: 'update', title: `${label} update`, body: 'Host update', pinned: false, publishedAt: '2026-10-19T12:00:00Z', publishedBy: 'Host' }],
  memories: [], visibleAttendees: 0,
});
const hubTickets = (label, slug) => ({
  attendee: { attendeeId: `${label} owner` },
  orders: [{ roomAccess: true, orderId: 'order', reference: `${label} reference`, eventSlug: slug, faceAmountMinor: 0, bookingFeeMinor: 0, totalAmountMinor: 0, currency: 'GHS', paidAt: null, bookedFor: null, canViewPurchase: true, tierName: 'RSVP', tierDescription: null, roomBadge: null,
    tickets: [{ id: `${label} ticket`, ticketType: 'RSVP', status: 'issued', checkedInAt: null, gateCode: `${label} gate`, qrPayload: `${label} QR` }],
  }],
});

// Execute the actual hub, including its load/retry effects and rendered guards.
function mountHub() {
  const slots = [], effects = new Map(), calls = [], offline = { clears: 0, reconciliations: [] };
  const document = new EventTarget(), window = new EventTarget(), navigator = { onLine: true };
  document.hidden = false;
  let cursor = 0, tree, dirty = false, mounted = true, updatesAfterUnmount = 0, event = hubEvent;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) {
      const state = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial };
      state.set ??= value => {
        if (!mounted) updatesAfterUnmount++;
        const next = typeof value === 'function' ? value(state.value) : value;
        if (!Object.is(next, state.value)) { state.value = next; dirty = true; }
      };
      return [state.value, state.set];
    },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
    },
    useEffect(setup, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) effects.set(index, { setup, dependencies });
    },
  };
  class RequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const requestJson = (url, init) => new Promise((resolve, reject) => calls.push({ url, init, respond: resolve, reject }));
  const jsx = (type, props) => ({ type, props });
  const componentModule = { exports: {} };
  runInNewContext(hubCode, {
    module: componentModule, exports: componentModule.exports, document, window, navigator, AbortController,
    require(specifier) {
      if (specifier === 'react') return react;
      if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (specifier === 'next/navigation') return { useSearchParams: () => new URLSearchParams('view=passes') };
      if (specifier === 'next/link') return { __esModule: true, default: 'a' };
      if (specifier === 'lucide-react') return new Proxy({}, { get: (_, name) => name });
      if (specifier.endsWith('/client-request')) return { requestJson, RequestError, requestErrorMessage: error => error.message };
      if (specifier.endsWith('/use-current-time')) return { useCurrentTime: () => Date.parse('2026-10-19T12:00:00Z') };
      if (specifier.endsWith('/offline-tickets')) return { clearOfflineTickets: () => offline.clears++, reconcileOfflineTickets: (...args) => offline.reconciliations.push(args) };
      return { __esModule: true, default: specifier };
    },
  });
  function commit() {
    if (!mounted) return;
    let renders = 0;
    do {
      assert.ok(++renders < 20, 'hub effects must converge');
      dirty = false; cursor = 0; tree = componentModule.exports.default({ event });
      for (const [index, effect] of effects) {
        slots[index]?.cleanup?.(); slots[index] = effect; effect.cleanup = effect.setup();
      }
      effects.clear();
    } while (dirty);
  }
  const flush = async () => { await new Promise(setImmediate); commit(); };
  commit();
  return {
    calls, flush, offline,
    get text() { return text(tree); },
    get privateState() { return JSON.stringify(slots.filter(slot => Object.hasOwn(slot, 'value')).map(slot => slot.value)); },
    get qrPayloads() { return nodes(tree).filter(node => typeof node.type === 'string' && node.type.endsWith('/qr-pass')).map(node => node.props.payload); },
    get listeners() { return getEventListeners(document, 'visibilitychange').length + getEventListeners(window, 'focus').length + getEventListeners(window, 'online').length; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    async navigate(slug) { event = { ...event, slug }; commit(); await flush(); },
    async resume(kind) {
      if (kind === 'button') nodes(tree).find(node => node.type === 'button' && /^(Check access again|Try again)$/.test(text(node))).props.onClick();
      else if (kind === 'visibilitychange') document.dispatchEvent(new Event(kind));
      else window.dispatchEvent(new Event(kind));
      await flush();
    },
    async deny(call, status) { call.reject(new RequestError('Access denied', status)); await flush(); },
    async succeed(batch, label = 'CURRENT_PRIVATE') {
      batch[0].respond(hubExperience(label)); batch[1].respond(hubTickets(label, event.slug)); batch[2].respond({ apple: true, google: false }); await flush();
    },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}

for (const status of [401, 403]) {
  for (const resume of ['focus', 'online', 'visibilitychange', 'button']) {
    test(`hub clears private state on ${status} and stays locked during ${resume} reauthentication`, async () => {
      const page = mountHub();
      await page.succeed(page.calls.slice(), 'OLD_PRIVATE');
      assert.deepEqual(page.qrPayloads, ['OLD_PRIVATE QR']);
      assert.match(page.text, /OLD_PRIVATE update/);
      await page.navigate('denied-fixture');
      await page.deny(page.calls[3], status);
      assert.match(page.text, /Open your passes securely/);
      assert.deepEqual(page.qrPayloads, []);
      assert.doesNotMatch(page.privateState, /OLD_PRIVATE/);
      assert.equal(page.offline.clears, status === 401 ? 1 : 0, 'retain the established 401/403 offline cache policy');
      await page.resume(resume);
      const retry = page.calls.slice(-3);
      assert.match(page.text, /Open your passes securely/, 'retry must not open the private view before authentication');
      assert.deepEqual(page.qrPayloads, []);
      retry[0].respond(hubExperience('CURRENT_PRIVATE')); await page.flush();
      assert.match(page.text, /Open your passes securely/, 'both private requests must validate before unlocking');
      retry[1].respond(hubTickets('CURRENT_PRIVATE', 'denied-fixture'));
      retry[2].respond({ apple: false, google: false }); await page.flush();
      assert.deepEqual(page.qrPayloads, ['CURRENT_PRIVATE QR']);
      assert.match(page.text, /CURRENT_PRIVATE update/);
      assert.doesNotMatch(page.text, /OLD_PRIVATE/);
      assert.equal(page.listeners, 0);
      page.unmount();
    });
  }
}

test('hub retries cannot unlock on network errors or malformed private responses', async () => {
  const page = mountHub();
  await page.deny(page.calls[0], 401);
  await page.resume('focus');
  page.calls[3].reject(new Error('offline')); await page.flush();
  assert.match(page.text, /Your night is taking a moment/);
  await page.resume('online');
  assert.match(page.text, /Open your passes securely/);
  const retry = page.calls.slice(-3);
  retry[0].respond(hubExperience('INVALID_PRIVATE')); retry[1].respond({ orders: [] }); retry[2].respond({ apple: false, google: false });
  await page.flush();
  assert.match(page.text, /Your night is taking a moment/);
  assert.doesNotMatch(page.privateState, /INVALID_PRIVATE/);
  await page.resume('button');
  page.unmount();
});

test('hub ignores superseded success and cleans up pending access checks on unmount', async () => {
  const page = mountHub();
  await page.deny(page.calls[0], 403);
  await page.resume('focus'); const stale = page.calls.slice(-3);
  await page.resume('online'); const latest = page.calls.slice(-3);
  assert.equal(stale[0].init.signal.aborted, true);
  await page.succeed(stale, 'STALE_PRIVATE');
  assert.match(page.text, /Open your passes securely/);
  assert.doesNotMatch(page.privateState, /STALE_PRIVATE/);
  page.unmount();
  assert.equal(latest[0].init.signal.aborted, true);
  assert.equal(page.listeners, 0);
  await page.succeed(latest);
  assert.equal(page.updatesAfterUnmount, 0);
});

test('optional wallet failure does not prevent validated private access recovery', async () => {
  const page = mountHub();
  await page.deny(page.calls[0], 401);
  await page.resume('button');
  const retry = page.calls.slice(-3);
  retry[0].respond(hubExperience('CURRENT_PRIVATE'));
  retry[1].respond(hubTickets('CURRENT_PRIVATE', hubEvent.slug));
  retry[2].reject(new Error('wallet unavailable')); await page.flush();
  assert.deepEqual(page.qrPayloads, ['CURRENT_PRIVATE QR']);
  assert.doesNotMatch(page.text, /Add to Apple Wallet/);
  page.unmount();
});
