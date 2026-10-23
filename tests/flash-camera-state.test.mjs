import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../app/room/[slug]/flash-camera.tsx", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const filterSource = await readFile(new URL("../lib/flash-photo-filters.ts", import.meta.url), "utf8");
const filterModule = { exports: {} };
runInNewContext(transformSync(filterSource, { loader: "ts", format: "cjs" }).code, { module: filterModule, exports: filterModule.exports });

// Exercise the real camera component's event/effect ordering without inventing browser layout.
// The separate Playwright journey verifies native rendering, touch, image decoding and CSS.
function mountCamera() {
  const slots = [], effects = new Map(), timers = new Map(), renders = [], sent = [], urls = new Map(), revoked = [], captures = [];
  let cursor = 0, dirty = false, tree, timerId = 0, urlId = 0, closed = 0, mediaCalls = 0, stopped = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { const value = typeof next === "function" ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback; },
    useEffect(setup, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.set(i, { deps, setup }); },
  };
  const document = new EventTarget(); document.visibilityState = "visible";
  document.createElement = () => {
    const capture = { width: 0, height: 0, translated: [], scaled: [], drawn: [], getContext: () => ({ translate: (...args) => capture.translated.push(args), scale: (...args) => capture.scaled.push(args), drawImage: (...args) => capture.drawn.push(args) }), toBlob: resolve => resolve(new Blob(["captured-original"], { type: "image/jpeg" })) };
    captures.push(capture); return capture;
  };
  const video = { videoWidth: 1920, videoHeight: 1080, srcObject: null, play: async () => {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) };
  const filters = { ...filterModule.exports, renderFlashLook: (canvas, look, strength, signal) => new Promise((resolve, reject) => renders.push({ canvas, look, strength, signal, resolve, reject })) };
  const compiledModule = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  runInNewContext(compiled, {
    module: compiledModule, exports: compiledModule.exports, document, File, Blob, FormData, AbortController,
    navigator: { mediaDevices: { getUserMedia: async () => { mediaCalls++; return { getTracks: () => [{ stop: () => stopped++ }] }; } } },
    URL: { createObjectURL: blob => { const url = `blob:fixture-${++urlId}`; urls.set(url, blob); return url; }, revokeObjectURL: url => revoked.push(url) },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "next/image") return "Image";
      if (id === "lucide-react") return { ArrowUp: "ArrowUp", Camera: "Camera", RefreshCw: "RefreshCw", X: "X" };
      if (id === "../../room-overlay") return "RoomOverlay";
      if (id === "./flash-look-picker") return "FlashLookPicker";
      if (id === "./flash-live-preview") return "FlashLivePreview";
      if (id.endsWith("flash-photo-filters")) return filters;
      if (id.endsWith("client-request")) return { requestErrorMessage: error => error.message, requestJson: async (url, options) => { sent.push({ url, body: options.body }); return { flash: { id: "sent-flash" } }; } };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  function nodes() {
    const found = [];
    function walk(node) { if (!node) return; if (Array.isArray(node)) return node.forEach(walk); if (typeof node !== "object") return; found.push(node); if (node.props) walk(node.props.children); }
    walk(tree.props.children(() => { tree.props.beforeClose(); closed++; })); return found;
  }
  function commit() {
    let guard = 0;
    do {
      assert.ok(++guard < 20); cursor = 0; dirty = false;
      tree = compiledModule.exports.default({ slug: "test-room", onClose: () => closed++, onSent: () => {} });
      nodes().filter(node => node.type === "video").forEach(node => { node.props.ref.current = video; });
      const pending = [...effects]; effects.clear();
      for (const [i] of pending) slots[i]?.cleanup?.();
      for (const [i, effect] of pending) { slots[i] = effect; effect.cleanup = effect.setup(); }
    } while (dirty);
  }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); if (dirty) commit(); } }
  const one = predicate => { const result = nodes().find(predicate); assert.ok(result, "Expected rendered node"); return result; };
  const button = text => one(node => node.type === "button" && (node.props["aria-label"] === text || node.props.children === text || Array.isArray(node.props.children) && node.props.children[0] === text));
  commit();
  return {
    renders, sent, urls, revoked, captures, video, document,
    get stopped() { return stopped; }, get closed() { return closed; }, get mediaCalls() { return mediaCalls; },
    settle, button, nodes,
    async capture() { await settle(); await button("Take Flash photo").props.onClick(); await settle(); },
    async click(text) { const node = button(text); assert.ok(!node.props.disabled, `${text} is enabled`); node.props.onClick(); commit(); await settle(); },
    liveReady() { one(node => node.type === "FlashLivePreview").props.onReady(true); commit(); },
    pick(look) { one(node => node.type === "FlashLookPicker").props.onLook(look); commit(); },
    strength(value) { one(node => node.type === "FlashLookPicker").props.onStrength(value); commit(); },
    consent() { one(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } }); commit(); },
    load() { const image = one(node => node.type === "Image"); image.props.onLoad({ currentTarget: { currentSrc: image.props.src } }); commit(); return image.props.src; },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); commit(); },
    hold() { one(node => node.props.className === "flash-capture__preview").props.onPointerDown({ button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } }); commit(); },
    release() { one(node => node.props.className === "flash-capture__preview").props.onPointerCancel(); commit(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("Original uses the captured bytes and consent plus loaded preview gate every send", async () => {
  const app = mountCamera(); await app.capture();
  assert.ok(app.button("Send Flash").props.disabled);
  assert.equal(app.nodes().find(node => node.type === "Image").props.style.objectFit, "contain", "Explicit style overrides the vinext fill shim’s inline cover default");
  app.consent(); assert.ok(app.button("Send Flash").props.disabled);
  const url = app.load(); assert.equal(app.button("Send Flash").props.disabled, false);
  await app.click("Send Flash");
  assert.equal(app.sent.length, 1); assert.equal(await app.sent[0].body.get("photo").text(), await app.urls.get(url).text());
  assert.equal(app.sent[0].body.get("consent"), "yes"); assert.equal(app.renders.length, 0);
  app.unmount();
});
test("the reviewed filtered Blob, not CSS or the original, becomes the upload", async () => {
  const app = mountCamera(); await app.capture(); app.load(); app.consent(); app.pick("noir"); app.flushTimers();
  assert.ok(app.button("Send Flash").props.disabled);
  app.renders[0].resolve(new Blob(["graded-noir"], { type: "image/jpeg" })); await app.settle();
  assert.ok(app.button("Send Flash").props.disabled); app.load();
  await app.click("Send Flash"); assert.equal(await app.sent[0].body.get("photo").text(), "graded-noir");
  app.unmount();
});
test("rapid changes and retakes cannot send stale jobs, even if a cancelled job resolves", async () => {
  const app = mountCamera(); await app.capture(); app.load(); app.consent(); app.pick("noir"); app.flushTimers();
  const old = app.renders[0]; app.pick("35mm"); app.flushTimers(); assert.ok(old.signal.aborted);
  old.resolve(new Blob(["stale"])); await app.settle(); assert.ok(app.button("Send Flash").props.disabled);
  app.renders[1].resolve(new Blob(["current"])); await app.settle(); app.load();
  await app.click("Retake"); assert.equal(app.captures[0].width, 0); assert.ok(app.revoked.length >= 2);
  app.liveReady(); await app.capture(); app.flushTimers(); app.load(); assert.ok(app.button("Send Flash").props.disabled);
  assert.equal(app.renders[2].look, "35mm"); app.renders[2].resolve(new Blob(["retake-grade"])); await app.settle();
  app.consent(); app.load(); await app.click("Send Flash"); assert.equal(await app.sent[0].body.get("photo").text(), "retake-grade");
  app.unmount();
});
test("selecting the active look or unchanged strength does not cancel its pending render", async () => {
  const app = mountCamera(); await app.capture(); app.pick("chrome"); app.flushTimers();
  app.pick("chrome"); app.strength(100); assert.equal(app.renders[0].signal.aborted, false);
  app.renders[0].resolve(new Blob(["chrome"])); await app.settle(); app.consent(); app.load();
  assert.equal(app.button("Send Flash").props.disabled, false); app.unmount();
});
test("zero strength returns exact original without re-encoding and cancels pending grades", async () => {
  const app = mountCamera(); await app.capture(); const original = app.load(); app.consent(); app.pick("35mm"); app.flushTimers();
  app.strength(0); assert.ok(app.renders[0].signal.aborted); app.load(); await app.click("Send Flash");
  assert.equal(await app.sent[0].body.get("photo").text(), await app.urls.get(original).text()); app.unmount();
});
test("hold/cancel and accessible toggle compare Original without accidentally sending it", async () => {
  const app = mountCamera(); await app.capture(); app.load(); app.consent(); app.pick("after-hours"); app.flushTimers();
  app.renders[0].resolve(new Blob(["after-hours"])); await app.settle(); app.load();
  app.hold(); assert.ok(app.button("Send Flash").props.disabled); app.release(); app.load();
  assert.equal(app.button("Send Flash").props.disabled, false);
  await app.click("Show original"); assert.ok(app.button("Send Flash").props.disabled);
  await app.click("Back to look"); app.load(); assert.equal(app.button("Send Flash").props.disabled, false); app.unmount();
});
test("failed grades are retryable and Original remains available", async () => {
  const app = mountCamera(); await app.capture(); app.pick("noir"); app.flushTimers();
  app.renders[0].reject(new Error("Encoding failed")); await app.settle();
  await app.click("Retry look"); app.flushTimers(); assert.equal(app.renders.length, 2);
  app.pick("original"); app.consent(); app.load(); assert.equal(app.button("Send Flash").props.disabled, false); app.unmount();
});
test("front camera preserves the entire sensor then mirrors once; backgrounding stops camera", async () => {
  const app = mountCamera(); await app.settle(); await app.click("Switch camera"); await app.capture();
  const capture = app.captures[0]; assert.deepEqual(capture.scaled, [[-1, 1]]);
  assert.deepEqual(capture.translated, [[capture.width, 0]]);
  assert.equal(capture.drawn[0][1], 0); assert.equal(capture.drawn[0][2], 0); assert.equal(capture.drawn[0].length, 9);
  assert.ok(capture.height <= 1600 && Math.abs(capture.width / capture.height - 1920 / 1080) < .002);
  const calls = app.mediaCalls; app.document.visibilityState = "hidden"; app.document.dispatchEvent(new Event("visibilitychange"));
  app.document.visibilityState = "visible"; app.document.dispatchEvent(new Event("visibilitychange")); await app.settle();
  assert.equal(app.mediaCalls, calls, "Captured still does not reopen camera when returning");
  app.unmount(); assert.equal(capture.width, 0);
});
test("closing aborts render and revokes all retained photo URLs", async () => {
  const app = mountCamera(); await app.capture(); app.pick("noir"); app.flushTimers();
  await app.click("Close camera"); assert.ok(app.renders[0].signal.aborted);
  app.unmount(); assert.ok([...app.urls.keys()].every(url => app.revoked.includes(url)));
});

test("live looks are selectable before shutter and the chosen grade survives capture", async () => {
  const app = mountCamera(); await app.settle();
  assert.ok(app.nodes().some(node => node.type === "FlashLookPicker" && !node.props.source));
  app.pick("amber"); app.strength(61); assert.ok(app.button("Take Flash photo").props.disabled);
  app.liveReady(); assert.equal(app.button("Take Flash photo").props.disabled, false);
  await app.capture(); app.flushTimers();
  assert.equal(app.renders[0].look, "amber"); assert.equal(app.renders[0].strength, 61);
  app.renders[0].resolve(new Blob(["live-amber"])); await app.settle(); app.load(); app.consent();
  await app.click("Send Flash"); assert.equal(await app.sent[0].body.get("photo").text(), "live-amber");
  app.unmount();
});

const liveSource = await readFile(new URL("../app/room/[slug]/flash-live-preview.tsx", import.meta.url), "utf8");
const liveCompiled = transformSync(liveSource, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
function mountLivePreview({ noContext = false, brokenRead = false, renderCost = 5 } = {}) {
  const slots = [], effects = new Map(), frames = new Map(), readiness = [], errors = [], draws = [], transforms = [];
  let cursor = 0, dirty = false, id = 0, tree, output, workTime = 0;
  const document = { visibilityState: "visible" };
  const video = { current: { videoWidth: 1920, videoHeight: 1080 } };
  const context = {
    setTransform: (...args) => transforms.push(args), resetTransform() {}, drawImage: (...args) => draws.push(args),
    getImageData: () => { if (brokenRead) throw new Error("Unavailable pixels"); return { data: new Uint8ClampedArray([153, 96, 69, 255]) }; },
    putImageData: image => { output = image.data; },
  };
  const canvas = { width: 0, height: 0, getContext: () => noContext ? null : context };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { if (slots[i].value !== next) { slots[i].value = next; dirty = true; } }]; },
    useEffect(setup, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.set(i, { deps, setup }); },
  };
  const component = { exports: {} };
  runInNewContext(liveCompiled, {
    module: component, exports: component.exports, document,
    performance: { now: () => { workTime += renderCost; return workTime; } },
    requestAnimationFrame: callback => { const next = ++id; frames.set(next, callback); return next; }, cancelAnimationFrame: value => frames.delete(value),
    require: name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name.endsWith("flash-photo-filters")) return filterModule.exports;
      throw new Error(name);
    },
  });
  let props = { video, look: "amber", strength: 100, mirrored: false, ready: true, onReady: value => readiness.push(value), onError: value => errors.push(value) };
  function commit() {
    do {
      cursor = 0; dirty = false; tree = component.exports.default(props); tree.props.ref.current = canvas;
      const pending = [...effects]; effects.clear();
      for (const [i] of pending) slots[i]?.cleanup?.();
      for (const [i, effect] of pending) { slots[i] = effect; effect.cleanup = effect.setup(); }
    } while (dirty);
  }
  commit();
  return {
    canvas, video, document, readiness, errors, draws, transforms, frames,
    failRead() { brokenRead = true; },
    get output() { return output; }, get visible() { return tree.props.style.visibility; },
    update(next) { props = { ...props, ...next }; commit(); },
    tick(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); if (dirty) commit(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test("live rendering uses the export kernel at bounded full-frame dimensions and throttles work", () => {
  const live = mountLivePreview(); assert.equal(live.visible, "hidden");
  live.tick(0); assert.equal(live.visible, "visible");
  assert.equal(live.canvas.width, 480); assert.equal(live.canvas.height, 270);
  assert.deepEqual(live.draws[0].slice(1), [0, 0, 480, 270]);
  const expected = new Uint8ClampedArray([153, 96, 69, 255]); filterModule.exports.gradeFlashPixels(expected, "amber", 100);
  assert.deepEqual(live.output, expected); assert.deepEqual(live.readiness, [false, true]);
  live.tick(16); live.tick(32); assert.equal(live.draws.length, 1);
  live.tick(34); assert.equal(live.draws.length, 2);
  live.document.visibilityState = "hidden"; live.tick(160); assert.equal(live.draws.length, 2);
  live.document.visibilityState = "visible"; live.tick(240); assert.equal(live.draws.length, 3);
  live.unmount(); assert.equal(live.frames.size, 0); assert.equal(live.canvas.width, 0); assert.equal(live.canvas.height, 0);
});
test("live changes invalidate the old preview, mirror once, resize and preserve strength", () => {
  const live = mountLivePreview(); live.tick(0); live.update({ look: "silver", strength: 62, mirrored: true });
  assert.equal(live.visible, "hidden"); assert.equal(live.readiness.at(-1), false);
  live.video.current.videoWidth = 1080; live.video.current.videoHeight = 1920;
  live.tick(80); assert.equal(live.canvas.width, 270); assert.equal(live.canvas.height, 480);
  assert.deepEqual(live.transforms.at(-1), [-1, 0, 0, 1, 270, 0]);
  const expected = new Uint8ClampedArray([153, 96, 69, 255]); filterModule.exports.gradeFlashPixels(expected, "silver", 62);
  assert.deepEqual(live.output, expected);
  live.update({ look: "original" }); assert.equal(live.visible, "hidden"); assert.equal(live.frames.size, 0);
  live.update({ look: "amber", strength: 0 }); assert.equal(live.frames.size, 0);
  live.unmount();
});
test("live failures never mark the selected look ready and offer an Original fallback", () => {
  for (const options of [{ noContext: true }, { brokenRead: true }]) {
    const live = mountLivePreview(options); live.tick(0);
    assert.equal(live.frames.size, 0); assert.equal(live.visible, "hidden"); assert.equal(live.readiness.at(-1), false);
    assert.match(live.errors[0], /Choose Original/u); live.unmount();
  }
});

test("a later live frame failure removes a stale visible grade", () => {
  const live = mountLivePreview(); live.tick(0); assert.equal(live.visible, "visible");
  live.failRead(); live.tick(80);
  assert.equal(live.visible, "hidden"); assert.equal(live.readiness.at(-1), false);
  assert.equal(live.frames.size, 0); assert.match(live.errors[0], /Choose Original/u); live.unmount();
});

test("expensive live frames adapt their cadence without expanding resolution", () => {
  const live = mountLivePreview({ renderCost: 45 }); live.tick(0);
  live.tick(34); live.tick(80); assert.equal(live.draws.length, 1);
  live.tick(90); assert.equal(live.draws.length, 2);
  assert.equal(live.canvas.width, 480); assert.equal(live.canvas.height, 270); live.unmount();
});
