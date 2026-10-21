import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const source = await readFile(new URL('../app/use-room-updates.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
function mountUpdates() {
  const slots = [], effects = new Map(), requests = [];
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = 'visible';
  window.setTimeout = window.setInterval = () => 1;
  window.clearTimeout = window.clearInterval = () => {};
  let cursor = 0, api, enabled = true, pathname = '/tickets';
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (callback, dependencies, evaluate) => {
    const index = cursor++;
    if (!equal(slots[index]?.dependencies, dependencies)) slots[index] = { value: evaluate ? callback() : callback, dependencies };
    return slots[index].value;
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; const state = slots[index] ??= { value }; return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }]; },
    useCallback: (callback, dependencies) => memo(callback, dependencies, false),
    useMemo: (callback, dependencies) => memo(callback, dependencies, true),
    useEffect(setup, dependencies) { const index = cursor++; if (!equal(slots[index]?.dependencies, dependencies)) effects.set(index, { setup, dependencies }); },
  };
  const component = { exports: {} };
  runInNewContext(compiled, { module: component, exports: component.exports, window, document, AbortController, Date,
    require(name) {
      if (name === 'react') return react;
      if (name === '../lib/client-request') return { requestJson: (_url, init) => new Promise(resolve => requests.push({ resolve, signal: init.signal })) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const render = () => {
    cursor = 0; effects.clear(); api = component.exports.useRoomUpdates(enabled, pathname);
    for (const index of effects.keys()) slots[index]?.cleanup?.();
    for (const [index, effect] of effects) slots[index] = { ...effect, cleanup: effect.setup() };
  };
  render();
  return { get api() { return api; }, requests, render, window,
    navigate(path, active) { pathname = path; enabled = active; render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const privateRooms = () => ({ rooms: [{ eventSlug: 'private-night', title: 'Private night', unread: 3, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }] });

test('same-path session invalidation clears private counts before a replacement response and aborts stale reads', async () => {
  const hook = mountUpdates();
  const initial = hook.api.refresh(); hook.requests[0].resolve(privateRooms()); await initial; hook.render();
  assert.equal(hook.api.rooms.length, 1);
  const pending = hook.api.refresh();
  hook.window.dispatchEvent(new Event('bct:attendee-session-changed')); hook.render();
  assert.equal(hook.api.rooms.length, 0);
  assert.equal(hook.requests[1].signal.aborted, true);
  hook.requests[1].resolve(privateRooms()); await pending; hook.render();
  assert.equal(hook.api.rooms.length, 0, 'an old in-flight result cannot restore private metadata');
  hook.requests[2].resolve({ rooms: [] }); await Promise.resolve(); hook.render();
  assert.equal(hook.api.rooms.length, 0);
  hook.unmount();
});

test('successful wallet sign-out emits invalidation only after the server confirms it', async () => {
  const wallet = await readFile(new URL('../app/tickets/ticket-wallet.tsx', import.meta.url), 'utf8');
  const signOut = wallet.slice(wallet.indexOf('async function signOut()'), wallet.indexOf('async function requestRecovery'));
  assert.match(signOut, /if \(!response.ok\) throw[\s\S]+setWallet\(null\);\s*window.dispatchEvent\(new Event\("bct:attendee-session-changed"\)\)/u);
});


test('returning from a disabled Room route cannot restore a prior cached summary', async () => {
  const hook = mountUpdates();
  const initial = hook.api.refresh(); hook.requests[0].resolve(privateRooms()); await initial; hook.render();
  assert.equal(hook.api.rooms.length, 1);
  const pending = hook.api.refresh();
  hook.navigate('/room/private-night', false);
  assert.equal(hook.api.rooms.length, 0);
  assert.equal(hook.requests[1].signal.aborted, true);
  hook.requests[1].resolve(privateRooms()); await pending; hook.render();
  hook.navigate('/tickets', true);
  assert.equal(hook.api.rooms.length, 0);
  hook.unmount();
});
