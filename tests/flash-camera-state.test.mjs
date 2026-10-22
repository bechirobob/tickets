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
  await app.capture(); app.load(); assert.ok(app.button("Send Flash").props.disabled);
  app.consent(); await app.click("Send Flash"); assert.equal(await app.sent[0].body.get("photo").text(), "captured-original");
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
test("front camera crops the visible frame then mirrors once; backgrounding stops camera", async () => {
  const app = mountCamera(); await app.settle(); await app.click("Switch camera"); await app.capture();
  const capture = app.captures[0]; assert.deepEqual(capture.scaled, [[-1, 1]]);
  assert.deepEqual(capture.translated, [[capture.width, 0]]);
  assert.ok(capture.drawn[0][1] > 0); assert.equal(capture.drawn[0].length, 9);
  assert.ok(capture.height <= 1600 && Math.abs(capture.width / capture.height - 390 / 844) < .002);
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
