import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../app/use-header-panel.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;

// Execute the real hook while controlling the gap between an event and React's
// passive cleanup. Browser tests retain the real DOM, breakpoint and Back checks.
function mountPanel(reducedMotion = true) {
  const slots = [];
  const pendingEffects = new Map();
  const frames = new Map();
  const timers = new Map();
  const window = new EventTarget();
  const document = new EventTarget();
  const router = { push() {} };
  const releaseHistory = () => Promise.resolve();
  let cursor = 0;
  let nextFrame = 0;
  let nextTimer = 0;
  let pathname = "/events";
  let onBack;
  let rendering = false;
  let renderAgain = false;
  let api;
  let active = "trigger";
  const focusLog = [];
  const sameDependencies = (previous, next) => previous && next && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  const react = {
    useId: () => "test-panel",
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      const state = slots[index] ??= { value };
      return [state.value, next => {
        if (Object.is(state.value, next)) return;
        state.value = next;
        if (rendering) renderAgain = true;
      }];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(setup, dependencies) {
      const index = cursor++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) pendingEffects.set(index, { setup, dependencies });
    },
  };
  window.matchMedia = () => ({ matches: reducedMotion });
  const component = { exports: {} };
  runInNewContext(compiled, {
    module: component, exports: component.exports,
    require(specifier) {
      if (specifier === "react") return react;
      if (specifier === "next/navigation") return { usePathname: () => pathname, useRouter: () => router };
      if (specifier === "./use-layer-history") return { useLayerHistory: (_open, callback) => { onBack = callback; return releaseHistory; } };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    window, document, CustomEvent,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const render = () => {
    do {
      cursor = 0;
      renderAgain = false;
      pendingEffects.clear();
      rendering = true;
      api = component.exports.useHeaderPanel();
      rendering = false;
    } while (renderAgain);
  };
  const flushEffects = () => {
    for (const index of pendingEffects.keys()) slots[index]?.cleanup?.();
    for (const [index, effect] of pendingEffects) slots[index] = { ...effect, cleanup: effect.setup() };
    pendingEffects.clear();
  };
  const focus = name => {
    active = name;
    focusLog.push({ name, pendingFrames: frames.size });
  };
  const makePanel = name => ({ querySelector: () => ({ focus: () => focus(name) }) });
  render();
  api.trigger.current = { focus: () => focus("trigger") };
  api.panel.current = makePanel("original-panel");
  flushEffects();
  return {
    get api() { return api; },
    get active() { return active; },
    get focusLog() { return focusLog; },
    get pendingFrames() { return frames.size; },
    open() { api.toggle(true); render(); flushEffects(); },
    commit() { render(); flushEffects(); },
    navigate(nextPath) { pathname = nextPath; render(); flushEffects(); },
    back() { onBack(); },
    escape() { const event = new Event("keydown", { cancelable: true }); event.key = "Escape"; document.dispatchEvent(event); },
    replacePanel() { api.panel.current = makePanel("replacement-panel"); },
    moveFocusOutside() { focus("outside"); },
    openSibling() { window.dispatchEvent(new CustomEvent("becore:header-panel", { detail: "other-panel" })); },
    takeFrame() {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      return () => callback(0);
    },
    flushFrames() { for (const [id, callback] of frames) { frames.delete(id); callback(0); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("an opening header panel focuses its first control on the next frame", () => {
  const panel = mountPanel();
  panel.open();
  assert.equal(panel.active, "trigger");
  assert.equal(panel.pendingFrames, 1);
  panel.flushFrames();
  assert.equal(panel.active, "original-panel");
  panel.unmount();
});

for (const reducedMotion of [true, false]) {
  test(`close cancels opening focus before restoring the trigger (reduced motion: ${reducedMotion})`, () => {
    const panel = mountPanel(reducedMotion);
    panel.open();
    panel.replacePanel();
    panel.api.close(true);
    assert.deepEqual(panel.focusLog.at(-1), { name: "trigger", pendingFrames: 0 });
    panel.flushFrames();
    assert.equal(panel.active, "trigger", "opening focus must not run before passive close cleanup");
    panel.commit();
    assert.equal(panel.api.open, false);
    panel.unmount();
  });
}

test("a frame from the old layout cannot focus a remounted header panel", () => {
  const panel = mountPanel();
  panel.open();
  panel.replacePanel();
  panel.flushFrames();
  assert.equal(panel.active, "trigger");
  panel.unmount();
});

test("close invalidates a dequeued opening callback before passive cleanup", () => {
  const panel = mountPanel();
  panel.open();
  const staleFrame = panel.takeFrame();
  panel.api.close(true);
  staleFrame();
  assert.equal(panel.active, "trigger");
  panel.unmount();
});

for (const reason of ["outside", "sibling"]) {
  test(`${reason} dismissal preserves the destination focus before passive cleanup`, () => {
    const panel = mountPanel();
    panel.open();
    panel.moveFocusOutside();
    if (reason === "sibling") panel.openSibling();
    else panel.api.close();
    panel.flushFrames();
    assert.equal(panel.active, "outside");
    panel.unmount();
  });
}

test("a dequeued stale callback cannot steal focus or consume a reopened panel's frame", () => {
  const panel = mountPanel();
  panel.open();
  const staleFrame = panel.takeFrame();
  panel.api.close(true);
  panel.commit();
  panel.open();
  staleFrame();
  assert.equal(panel.active, "trigger");
  assert.equal(panel.pendingFrames, 1);
  panel.flushFrames();
  assert.equal(panel.active, "original-panel");
  panel.unmount();
});

test("unmount cancels opening focus and invalidates an already dequeued callback", () => {
  for (const dequeued of [false, true]) {
    const panel = mountPanel();
    panel.open();
    const staleFrame = dequeued ? panel.takeFrame() : null;
    panel.unmount();
    assert.equal(panel.pendingFrames, 0);
    staleFrame?.();
    panel.flushFrames();
    assert.equal(panel.active, "trigger");
  }
});

for (const dismissal of ["back", "escape"]) {
  test(`${dismissal} restores trigger focus without waiting for passive cleanup`, () => {
    const panel = mountPanel();
    panel.open();
    panel[dismissal]();
    panel.flushFrames();
    assert.equal(panel.active, "trigger");
    panel.unmount();
  });
}

test("a route change cleans up pending focus without restoring the old trigger", () => {
  const panel = mountPanel();
  panel.open();
  const staleFrame = panel.takeFrame();
  panel.moveFocusOutside();
  panel.navigate("/help");
  assert.equal(panel.api.phase, "closed");
  staleFrame();
  panel.flushFrames();
  assert.equal(panel.active, "outside");
  panel.unmount();
});
