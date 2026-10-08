import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../app/admin/operations/organizer-activity.tsx", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
const snapshot = (unread = 2, asOf = "2026-10-08T22:00:00.000Z") => ({ activity: [], unread, asOf });

// Run the real component and effects with controlled network completion and time.
function mountActivity({ hidden = false } = {}) {
  const slots = [], effects = new Map(), timers = new Map(), calls = [];
  const document = new EventTarget();
  document.visibilityState = hidden ? "hidden" : "visible";
  let cursor = 0, now = 0, timerId = 0, tree, mounted = true, updatesAfterUnmount = 0;
  const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) {
      const state = slots[cursor++] ??= { value: initial };
      return [state.value, value => {
        if (!mounted) updatesAfterUnmount++;
        state.value = typeof value === "function" ? value(state.value) : value;
      }];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(setup, dependencies) {
      const index = cursor++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) effects.set(index, { setup, dependencies });
    },
  };
  function operationsFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
      calls.push({ url, init, reject,
        respond(data, ok = true) { resolve({ ok, json: async () => data }); },
        unreadable() { resolve({ ok: true, json: async () => { throw new Error("Invalid JSON"); } }); },
      });
    });
  }
  const component = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  runInNewContext(compiled, {
    module: component, exports: component.exports, document, AbortController,
    require(specifier) {
      if (specifier === "react") return react;
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (specifier === "next/link") return "a";
      if (specifier === "../../../lib/operations-client") return { operationsFetch };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, at: now + delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  function commit() {
    if (!mounted) return;
    cursor = 0;
    tree = component.exports.default();
    for (const [index, entry] of effects) {
      slots[index]?.cleanup?.();
      slots[index] = entry;
      entry.cleanup = entry.setup();
    }
    effects.clear();
  }
  async function flush() { await new Promise(setImmediate); commit(); }
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props.children)] : [];
  const text = node => Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
  commit();
  return {
    calls, flush,
    get timers() { return timers.size; },
    get listeners() { return getEventListeners(document, "visibilitychange").length; },
    get text() { return text(tree); },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > target) break;
        now = next.at; next.at += next.delay; next.callback();
        await flush();
      }
      now = target;
      await flush();
    },
    async hide(hidden) { document.visibilityState = hidden ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); await flush(); },
    async markRead() { nodes(tree).find(node => node.type === "button").props.onClick(); await flush(); },
    restartEffects() { for (const slot of slots) if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); } },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("activity polls immediately and every 30 seconds only while visible", async () => {
  const feed = mountActivity();
  await feed.flush();
  assert.equal(feed.calls.length, 1);
  assert.equal(feed.timers, 1);
  assert.equal(feed.calls[0].url, "/api/admin/organizer-activity");
  assert.ok(feed.calls[0].init.signal instanceof AbortSignal);
  feed.calls[0].respond(snapshot());
  await feed.advance(29999);
  assert.equal(feed.calls.length, 1);
  await feed.advance(1);
  assert.equal(feed.calls.length, 2);
  feed.calls[1].respond(snapshot());
  await feed.flush();
  await feed.hide(true);
  assert.equal(feed.timers, 0);
  await feed.advance(5 * 60000);
  assert.equal(feed.calls.length, 2);
  await feed.hide(false);
  assert.equal(feed.calls.length, 3, "returning to the tab refreshes immediately");
  feed.calls[2].respond(snapshot());
  await feed.flush();
  await feed.hide(false);
  assert.equal(feed.calls.length, 3, "duplicate visibility events do not restart polling");
  assert.equal(feed.timers, 1);
  await feed.advance(30000);
  assert.equal(feed.calls.length, 4);
  feed.unmount();
});

test("an initially hidden activity feed makes no request until visible", async () => {
  const feed = mountActivity({ hidden: true });
  await feed.flush();
  await feed.advance(120000);
  assert.equal(feed.calls.length, 0);
  assert.equal(feed.timers, 0);
  await feed.hide(false);
  assert.equal(feed.calls.length, 1);
  assert.equal(feed.timers, 1);
  feed.unmount();
});

test("slow activity requests do not overlap and visibility aborts stale results", async () => {
  const feed = mountActivity();
  await feed.flush();
  await feed.advance(90000);
  assert.equal(feed.calls.length, 1, "ticks skip an in-flight request");
  await feed.hide(true);
  assert.equal(feed.calls[0].init.signal.aborted, true);
  await feed.hide(false);
  assert.equal(feed.calls.length, 2);
  feed.calls[1].respond(snapshot(3));
  await feed.flush();
  feed.calls[0].respond(snapshot(99));
  await feed.flush();
  assert.match(feed.text, /3 new/);
  assert.doesNotMatch(feed.text, /99 new/);
  await feed.advance(30000);
  assert.equal(feed.calls.length, 3);
  feed.unmount();
});

for (const failure of ["http", "network", "json"]) {
  test(`activity recovers from ${failure} failure on the next visible tick`, async () => {
    const feed = mountActivity();
    await feed.flush();
    if (failure === "http") feed.calls[0].respond({ error: "Activity could not load." }, false);
    else if (failure === "network") feed.calls[0].reject(new Error("Offline"));
    else feed.calls[0].unreadable();
    await feed.flush();
    assert.match(feed.text, /Activity could not load/);
    await feed.advance(30000);
    assert.equal(feed.calls.length, 2);
    feed.calls[1].respond(snapshot(4));
    await feed.flush();
    assert.match(feed.text, /4 new/);
    assert.doesNotMatch(feed.text, /Activity could not load/);
    feed.unmount();
  });
}

test("mark read sends the displayed timestamp and refreshes after any older poll", async () => {
  const feed = mountActivity();
  await feed.flush();
  const asOf = "2026-10-08T22:10:00.000Z";
  feed.calls[0].respond(snapshot(2, asOf));
  await feed.flush();
  await feed.advance(30000);
  const olderPoll = feed.calls[1];
  await feed.markRead();
  const mutation = feed.calls[2];
  assert.equal(mutation.init.method, "POST");
  assert.equal(mutation.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(mutation.init.body), { asOf });
  mutation.respond({ ok: true });
  await feed.flush();
  assert.equal(olderPoll.init.signal.aborted, true);
  assert.equal(feed.calls.length, 4);
  olderPoll.respond(snapshot(2));
  await feed.flush();
  await feed.advance(30000);
  assert.equal(feed.calls.length, 4, "an aborted request must not clear the new in-flight guard");
  feed.calls[3].respond(snapshot(0));
  await feed.flush();
  assert.match(feed.text, /Up to date/);
  assert.doesNotMatch(feed.text, /Mark these updates as read/);
  feed.unmount();
});

test("mark read that finishes while hidden waits for visibility to refresh", async () => {
  const feed = mountActivity();
  await feed.flush();
  feed.calls[0].respond(snapshot());
  await feed.flush();
  await feed.markRead();
  await feed.hide(true);
  assert.equal(feed.calls[1].init.signal.aborted, false, "hiding must not cancel a submitted read update");
  feed.calls[1].respond({ ok: true });
  await feed.flush();
  assert.equal(feed.calls.length, 2);
  await feed.hide(false);
  assert.equal(feed.calls.length, 3);
  feed.calls[2].respond(snapshot(0));
  await feed.flush();
  assert.match(feed.text, /Up to date/);
  feed.unmount();
});

test("a failed mark-read request preserves unread activity and polling", async () => {
  const feed = mountActivity();
  await feed.flush();
  feed.calls[0].respond(snapshot());
  await feed.flush();
  await feed.markRead();
  feed.calls[1].respond({ error: "Unable to update" }, false);
  await feed.flush();
  assert.equal(feed.calls.length, 2, "failed mutations do not trigger a refresh");
  assert.match(feed.text, /2 new/);
  assert.match(feed.text, /Mark these updates as read/);
  await feed.advance(30000);
  assert.equal(feed.calls.length, 3);
  feed.unmount();
});

test("unmount aborts activity reads and mutations and prevents later work", async () => {
  const feed = mountActivity();
  await feed.flush();
  feed.calls[0].respond(snapshot());
  await feed.flush();
  await feed.advance(30000);
  await feed.markRead();
  assert.equal(feed.listeners, 1);
  feed.unmount();
  assert.equal(feed.timers, 0);
  assert.equal(feed.listeners, 0);
  assert.equal(feed.calls[1].init.signal.aborted, true);
  assert.equal(feed.calls[2].init.signal.aborted, true);
  feed.calls[1].respond(snapshot(99));
  feed.calls[2].respond({ ok: true });
  await feed.flush();
  await feed.hide(true);
  await feed.hide(false);
  await feed.advance(60000);
  assert.equal(feed.calls.length, 3);
  assert.equal(feed.updatesAfterUnmount, 0);
});

test("Strict Mode replay and immediate unmount leave no duplicate or deferred poll", async () => {
  const feed = mountActivity();
  feed.restartEffects();
  await feed.flush();
  assert.equal(feed.calls.length, 1);
  assert.equal(feed.timers, 1);
  assert.equal(feed.listeners, 1);
  feed.unmount();
  const early = mountActivity();
  early.unmount();
  await early.flush();
  assert.equal(early.calls.length, 0);
  assert.equal(early.timers, 0);
  assert.equal(early.listeners, 0);
});
