import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../app/use-room-demo.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;

// Exercise the real hook, including layout/passive effect ordering, against a
// deterministic clock. Hosted browser coverage supplies real layout and CSS.
function mountDemo(options = {}) {
  const props = { paused: false, reducedMotion: false, offset: 2000, ...options };
  const slots = [];
  const pendingLayout = new Map();
  const pendingEffects = new Map();
  const timers = new Map();
  const animations = [];
  const document = new EventTarget();
  document.visibilityState = options.hidden ? "hidden" : "visible";
  let cursor = 0;
  let dirty = false;
  let now = 0;
  let timerId = 0;
  let observer;
  let api;
  const sameDependencies = (previous, next) => previous && next && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  const effect = queue => (setup, dependencies) => {
    const index = cursor++;
    if (!sameDependencies(slots[index]?.dependencies, dependencies)) queue.set(index, { setup, dependencies });
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) {
      const index = cursor++;
      const state = slots[index] ??= { value: initial };
      return [state.value, value => {
        const next = typeof value === "function" ? value(state.value) : value;
        if (!Object.is(state.value, next)) { state.value = next; dirty = true; }
      }];
    },
    useLayoutEffect: effect(pendingLayout),
    useEffect: effect(pendingEffects),
  };
  const activeAnimations = element => animations.filter(animation => animation.element === element && animation.playState !== "idle" && animation.playState !== "finished");
  function makeItem(key) {
    const item = {
      dataset: { roomItem: key }, hidden: false, offsetTop: 0,
      getAnimations: () => activeAnimations(item),
      animate(keyframes, timing) {
        const animation = {
          element: item, keyframes, duration: timing.duration, currentTime: 0, playState: "running", cancelled: false,
          cancel() { this.cancelled = true; this.playState = "idle"; },
          play() { this.playState = "running"; },
          pause() { this.playState = "paused"; },
        };
        animations.push(animation);
        return animation;
      },
    };
    return item;
  }
  const items = Array.from({ length: 5 }, (_, index) => makeItem(`message-${index}`));
  const typing = makeItem("typing");
  let domItems = items;
  const stream = { querySelectorAll: () => domItems };
  const phone = { getAnimations: () => animations.filter(animation => animation.playState !== "idle" && animation.playState !== "finished") };
  const component = { exports: {} };
  runInNewContext(compiled, {
    module: component, exports: component.exports,
    require(specifier) {
      if (specifier === "react") return react;
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    document,
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    IntersectionObserver: function (callback, observerOptions) {
      observer = {
        callback, options: observerOptions, disconnected: false,
        observe(target) { this.target = target; },
        disconnect() { this.disconnected = true; },
      };
      return observer;
    },
  });
  const flush = queue => {
    const effects = [...queue];
    queue.clear();
    for (const [index] of effects) slots[index]?.cleanup?.();
    for (const [index, entry] of effects) {
      slots[index] = entry;
      entry.cleanup = entry.setup();
    }
  };
  function commit() {
    let renders = 0;
    do {
      assert.ok(++renders < 20, "hook effects should converge");
      cursor = 0;
      dirty = false;
      api = component.exports.useRoomDemo(props.paused, props.reducedMotion, props.offset);
      api.phoneRef.current = phone;
      api.streamRef.current = stream;
      const count = api.step >= 6 ? 5 : api.step >= 4 ? 4 : api.step >= 2 ? 3 : 2;
      items.forEach((item, index) => { item.hidden = index >= count; });
      domItems = api.typing ? [...items, typing] : items;
      const visible = domItems.filter(item => !item.hidden);
      visible.forEach((item, index) => { item.offsetTop = 400 - (visible.length - index) * 50; });
      flush(pendingLayout);
      flush(pendingEffects);
    } while (dirty);
  }
  function tickAnimations(delta) {
    for (const animation of animations) {
      if (animation.playState !== "running") continue;
      animation.currentTime += delta;
      if (animation.currentTime >= animation.duration) animation.playState = "finished";
    }
  }
  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      const [id, timer] = next;
      tickAnimations(timer.at - now);
      now = timer.at;
      timers.delete(id);
      timer.callback();
      commit();
    }
    tickAnimations(target - now);
    now = target;
  }
  commit();
  return {
    get api() { return api; },
    get timers() { return timers.size; },
    get animations() { return animations; },
    get observer() { return observer; },
    advance,
    set(next) { Object.assign(props, next); commit(); },
    intersect(ratio) { observer.callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); commit(); },
    hide(hidden) { document.visibilityState = hidden ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); commit(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("Room demo keeps complete content until a sufficiently visible phone can start", () => {
  const demo = mountDemo();
  assert.equal(demo.api.step, 6);
  assert.equal(demo.api.running, false);
  for (const ratio of [0, .3, .549]) {
    demo.intersect(ratio);
    demo.advance(5000);
    assert.equal(demo.api.step, 6);
    assert.equal(demo.timers, 0);
  }
  demo.intersect(.55);
  demo.advance(2000);
  assert.equal(demo.api.step, 0);
  assert.equal(demo.api.running, true);
  demo.unmount();
});

for (const reason of ["paused", "hidden"]) {
  test(`Room demo cancels delayed startup when ${reason} and restarts only when allowed`, () => {
    const demo = mountDemo();
    demo.intersect(1);
    demo.advance(1000);
    if (reason === "paused") demo.set({ paused: true });
    else demo.hide(true);
    assert.equal(demo.timers, 0);
    demo.advance(10000);
    assert.equal(demo.api.step, 6);
    assert.equal(demo.api.running, false);
    if (reason === "paused") demo.set({ paused: false });
    else demo.hide(false);
    demo.advance(1999);
    assert.equal(demo.api.step, 6);
    demo.advance(1);
    assert.equal(demo.api.step, 0);
    assert.equal(demo.api.running, true);
    demo.unmount();
  });
}

for (const options of [{ paused: true }, { hidden: true }, { reducedMotion: true }]) {
  test(`Room demo mounted with ${Object.keys(options)[0]} stays complete and static`, () => {
    const demo = mountDemo(options);
    demo.intersect(1);
    demo.advance(10000);
    assert.equal(demo.api.step, 6);
    assert.equal(demo.api.running, false);
    assert.equal(demo.api.typing, false);
    assert.equal(demo.timers, 0);
    assert.equal(demo.animations.length, 0);
    demo.unmount();
  });
}

for (const reason of ["offscreen", "hidden", "paused"]) {
  test(`Room demo freezes its current beat while ${reason} and resumes without skipping`, () => {
    const demo = mountDemo({ offset: 0 });
    demo.intersect(1);
    demo.advance(1600);
    assert.equal(demo.api.step, 1);
    if (reason === "offscreen") demo.intersect(.54);
    else if (reason === "hidden") demo.hide(true);
    else demo.set({ paused: true });
    assert.equal(demo.api.running, false);
    assert.equal(demo.timers, 0);
    demo.advance(10000);
    assert.equal(demo.api.step, 1);
    if (reason === "offscreen") demo.intersect(.8);
    else if (reason === "hidden") demo.hide(false);
    else demo.set({ paused: false });
    demo.advance(1400);
    assert.equal(demo.api.step, 2);
    demo.unmount();
  });
}

for (const reason of ["paused", "hidden", "offscreen"]) {
  test(`Room demo exposes complete content when ${reason} interrupts its reset`, () => {
    const demo = mountDemo({ offset: 0 });
    demo.intersect(1);
    demo.advance(16200);
    assert.equal(demo.api.step, 7);
    if (reason === "paused") demo.set({ paused: true });
    else if (reason === "hidden") demo.hide(true);
    else demo.intersect(0);
    assert.equal(demo.api.step, 6, "a stopped reset must expose the complete conversation");
    assert.equal(demo.api.typing, false);
    assert.equal(demo.api.running, false);
    demo.advance(10000);
    assert.equal(demo.api.step, 6);
    demo.unmount();
  });
}

test("enabling reduced motion settles a message insertion rather than freezing it midway", () => {
  const demo = mountDemo({ offset: 0 });
  demo.intersect(1);
  demo.advance(3000);
  assert.equal(demo.api.step, 2);
  const insertion = demo.animations.findLast(animation => animation.element.dataset.roomItem === "message-2" && animation.keyframes[0].opacity === 0);
  assert.ok(insertion, "the real hook should animate the newly inserted third message");
  demo.advance(100);
  assert.equal(insertion.playState, "running");
  demo.set({ reducedMotion: true });
  assert.equal(insertion.cancelled, true);
  assert.equal(demo.api.step, 6);
  assert.equal(demo.api.running, false);
  assert.equal(demo.timers, 0);
  assert.equal(demo.animations.some(animation => animation.playState === "paused" || animation.playState === "running"), false);
  demo.advance(10000);
  assert.equal(demo.api.step, 6);
  demo.unmount();
});

test("a stopped Room reset disables the opacity transition before animation pausing", async () => {
  const css = await readFile(new URL("../app/room-demo.css", import.meta.url), "utf8");
  // A complete hook state alone is insufficient: pausing the reverse CSS
  // transition could otherwise hold the stream at opacity zero indefinitely.
  assert.match(css, /\.room-product-phone\[data-demo-running=['"]false['"]\]\s+\.room-product-phone__stream\s*\{[^}]*opacity:\s*1\s*;[^}]*transition:\s*none\s*;/su);
});

test("unmount removes pending Room demo work and its intersection observer", () => {
  const demo = mountDemo();
  demo.intersect(1);
  assert.equal(demo.timers, 1);
  demo.unmount();
  assert.equal(demo.timers, 0);
  assert.equal(demo.observer.disconnected, true);
});
