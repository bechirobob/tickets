import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import ts from 'typescript';

const source = await readFile(new URL('../app/use-room-updates.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;

test('Room update hook typechecks with browser-only types and no server modules', () => {
  const program = ts.createProgram([fileURLToPath(new URL('../app/use-room-updates.ts', import.meta.url))], {
    noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  });
  const backendModules = program.getSourceFiles().filter(file => /\/lib\/(?:room-updates|attendee-auth|room-policy)\.ts$/u.test(file.fileName));
  assert.deepEqual(backendModules.map(file => file.fileName), [], 'type-only imports must not pull server/database modules into the browser graph');
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
});

function mountUpdates() {
  const slots = [], effects = new Map(), layoutEffects = new Map(), requests = [];
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = 'visible';
  window.setTimeout = window.setInterval = () => 1;
  window.clearTimeout = window.clearInterval = () => {};
  let cursor = 0, api, enabled = true, pathname = '/tickets';
  const isVisible = () => true;
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
    useLayoutEffect(setup, dependencies) { const index = cursor++; if (!equal(slots[index]?.dependencies, dependencies)) layoutEffects.set(index, { setup, dependencies }); },
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
  const render = ({ passive = true } = {}) => {
    cursor = 0; effects.clear(); layoutEffects.clear(); api = component.exports.useRoomUpdates(enabled, pathname, isVisible);
    for (const index of layoutEffects.keys()) slots[index]?.cleanup?.();
    for (const [index, effect] of layoutEffects) slots[index] = { ...effect, cleanup: effect.setup() };
    if (passive) {
      for (const index of effects.keys()) slots[index]?.cleanup?.();
      for (const [index, effect] of effects) slots[index] = { ...effect, cleanup: effect.setup() };
    }
  };
  render();
  return { get api() { return api; }, requests, render, window,
    navigate(path, active, options) { pathname = path; enabled = active; render(options); },
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

for (const [path, enabled] of [['/tickets', false], ['/room/private-night', false], ['/events', true]]) {
  test(`a queued old refresh cannot start after committing ${path} enabled=${enabled}`, async () => {
    const hook = mountUpdates();
    try {
      const staleRefresh = hook.api.refresh;
      hook.navigate(path, enabled, { passive: false });
      const stale = staleRefresh();
      assert.equal(hook.requests.length, 0, 'a callback captured before the commit must not start a stale Room request');
      assert.equal(await stale, null);
    } finally { hook.unmount(); }
  });
}

test('a route commit aborts its pending read before passive cleanup; an old callback cannot abort the new read', async () => {
  const hook = mountUpdates();
  try {
    const staleRefresh = hook.api.refresh;
    const oldRead = staleRefresh();
    hook.navigate('/events', true, { passive: false });
    assert.equal(hook.requests[0].signal.aborted, true);
    hook.requests[0].resolve(privateRooms()); await oldRead; hook.render();
    assert.equal(hook.api.rooms.length, 0);
    const currentRead = hook.api.refresh();
    assert.equal(hook.requests.length, 2);
    assert.equal(await staleRefresh(), null);
    assert.equal(hook.requests.length, 2);
    assert.equal(hook.requests[1].signal.aborted, false, 'a stale callback must not cancel the current route request');
    hook.requests[1].resolve(privateRooms()); await currentRead; hook.render();
    assert.equal(hook.api.rooms.length, 1);
  } finally { hook.unmount(); }
});

test('current refresh resumes after enabling, but cannot request after unmount', async () => {
  const hook = mountUpdates();
  hook.navigate('/tickets', false);
  const disabledRefresh = hook.api.refresh;
  hook.navigate('/tickets', true);
  assert.equal(await disabledRefresh(), null);
  const pending = hook.api.refresh();
  assert.equal(hook.requests.length, 1);
  const refresh = hook.api.refresh;
  hook.unmount();
  assert.equal(hook.requests[0].signal.aborted, true);
  assert.equal(await refresh(), null);
  assert.equal(hook.requests.length, 1);
  hook.requests[0].resolve(privateRooms()); await pending;
});

test('disabling aborts a pending private response at layout commit before passive cleanup', async () => {
  const hook = mountUpdates();
  try {
    const pending = hook.api.refresh();
    hook.navigate('/tickets', false, { passive: false });
    assert.equal(hook.requests[0].signal.aborted, true);
    hook.requests[0].resolve(privateRooms()); await pending;
    hook.render({ passive: false });
    assert.equal(hook.api.rooms.length, 0);
    hook.navigate('/tickets', true);
    assert.equal(hook.api.rooms.length, 0, 'a disabled response must not repopulate rooms on re-entry');
  } finally { hook.unmount(); }
});
