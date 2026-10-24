import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../lib/flash-photo-filters.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
function load(extras = {}) {
  const compiledModule = { exports: {} };
  runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, Uint8ClampedArray, Math, setTimeout, ...extras });
  return compiledModule.exports;
}
const { FLASH_LOOKS, flashStrength, flashCaptureFrame, flashCameraConstraints, gradeFlashPixels } = await import(`data:text/javascript;base64,${Buffer.from(transformSync(source, { loader: "ts", format: "esm" }).code).toString("base64")}`);
const fixture = () => new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255, 153, 96, 69, 123, 84, 52, 38, 255, 30, 90, 200, 255, 240, 130, 45, 255]);

test("Original and zero strength preserve every byte, including alpha", () => {
  for (const look of FLASH_LOOKS) {
    const pixels = fixture(); const before = pixels.slice();
    gradeFlashPixels(pixels, look.id, 0);
    assert.deepEqual(pixels, before);
  }
  const pixels = fixture(); gradeFlashPixels(pixels, "original", 100);
  assert.deepEqual(pixels, fixture());
});
test("strength is finite and bounded, with exact endpoint grades and intermediate blending", () => {
  assert.equal(flashStrength(-10), 0); assert.equal(flashStrength(250), 100);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(flashStrength(invalid), 0);
  for (const { id } of FLASH_LOOKS.slice(1)) {
    const full = fixture(); gradeFlashPixels(full, id, 100);
    const excess = fixture(); gradeFlashPixels(excess, id, 200); assert.deepEqual(excess, full);
    const half = fixture(); gradeFlashPixels(half, id, 50);
    const base = fixture();
    half.forEach((value, i) => assert.ok(Math.abs(value - (base[i] + full[i]) / 2) <= 1));
  }
});
test("all looks are deterministic, finite, geometry-free and preserve transparency", () => {
  for (const { id } of FLASH_LOOKS.slice(1)) {
    const pixels = fixture(); const repeat = fixture();
    gradeFlashPixels(pixels, id, 100); gradeFlashPixels(repeat, id, 100);
    assert.deepEqual(pixels, repeat); assert.notDeepEqual(pixels, fixture());
    assert.equal(pixels.length, fixture().length);
    for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], fixture()[i]);
    assert.ok([...pixels].every(value => value >= 0 && value <= 255));
  }
});
test("Noir is luminance monochrome; Chrome retains neutral greys", () => {
  const pixels = fixture(); gradeFlashPixels(pixels, "noir", 100);
  for (let i = 0; i < pixels.length; i += 4) { assert.equal(pixels[i], pixels[i + 1]); assert.equal(pixels[i], pixels[i + 2]); }
  const greys = new Uint8ClampedArray([30, 30, 30, 255, 128, 128, 128, 255, 220, 220, 220, 255]);
  gradeFlashPixels(greys, "chrome", 100);
  for (let i = 0; i < greys.length; i += 4) { assert.equal(greys[i], greys[i + 1]); assert.equal(greys[i], greys[i + 2]); }
});
test("grain is independent of chunk boundaries, subtle and repeatable", () => {
  const pixels = new Uint8ClampedArray(200_000 * 4).fill(128); const chunked = pixels.slice();
  gradeFlashPixels(pixels, "35mm", 100);
  for (let start = 0; start < 200_000; start += 7777) gradeFlashPixels(chunked, "35mm", 100, start, Math.min(200_000, start + 7777));
  assert.deepEqual(pixels, chunked);
  const reds = [...pixels.filter((_, i) => i % 4 === 0)];
  assert.ok(Math.max(...reds.slice(0, 1000)) - Math.min(...reds.slice(0, 1000)) <= 6);
});
test("capture preserves the entire sensor in either orientation without upscaling", () => {
  for (const [sw, sh] of [[1920, 1080], [1080, 1920], [4032, 3024], [3024, 4032], [480, 640]]) {
    const frame = flashCaptureFrame(sw, sh);
    assert.equal(frame.x, 0); assert.equal(frame.y, 0);
    assert.equal(frame.width, sw); assert.equal(frame.height, sh);
    assert.ok(Math.abs(frame.outputWidth / frame.outputHeight - sw / sh) < .002);
    assert.ok(frame.outputWidth <= 1600 && frame.outputHeight <= 1600);
    assert.ok(frame.outputWidth <= sw && frame.outputHeight <= sh);
  }
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => flashCaptureFrame(bad, 100));
});
test("camera constraints never request a portrait crop, microphone or digital zoom", () => {
  for (const facing of ["user", "environment"]) {
    const constraints = flashCameraConstraints(facing);
    assert.equal(constraints.audio, false);
    assert.equal(constraints.video.facingMode.ideal, facing);
    assert.equal(constraints.video.resizeMode, "none");
    assert.equal(constraints.video.height, undefined);
    assert.equal(constraints.video.aspectRatio, undefined);
    assert.equal(constraints.video.zoom, undefined);
  }
});
test("the ten looks remain distinct rather than duplicate colour presets", () => {
  assert.equal(FLASH_LOOKS.length, 10);
  const grades = FLASH_LOOKS.map(({ id }) => { const pixels = fixture(); gradeFlashPixels(pixels, id, 100); return [...pixels].join(","); });
  assert.equal(new Set(grades).size, 10);
});

function canvasFixture({ onYield, noContext = false, noBlob = false } = {}) {
  const original = new Uint8ClampedArray(400 * 300 * 4).fill(128);
  const calls = { encoded: 0, drawn: [], yielded: 0, output: null, canvas: null };
  const api = load({ document: { createElement: () => {
    const canvas = { width: 0, height: 0,
      getContext: () => noContext ? null : ({ drawImage: (...args) => calls.drawn.push(args), getImageData: () => ({ data: original.slice() }), putImageData: image => { calls.output = image.data; } }),
      toBlob: (resolve, type, quality) => { calls.encoded++; calls.format = [type, quality]; resolve(noBlob ? null : new Blob([calls.output ?? original])); },
    };
    calls.canvas = canvas; return canvas;
  } }, setTimeout: callback => { calls.yielded++; onYield?.(); queueMicrotask(callback); } });
  return { api, calls, original, source: { width: 400, height: 300 } };
}
test("renderer yields, preserves the source, uses one JPEG encoding and releases its canvas", async () => {
  const { api, calls, original, source } = canvasFixture();
  const before = original.slice();
  const blob = await api.renderFlashLook(source, "noir", 100, new AbortController().signal);
  assert.ok(blob.size > 0); assert.ok(calls.yielded >= 3); assert.equal(calls.encoded, 1);
  assert.deepEqual(original, before); assert.deepEqual(calls.format, ["image/jpeg", .88]);
  assert.equal(calls.canvas.width, 0); assert.equal(calls.canvas.height, 0);
});
test("stale rendering cancels between chunks before encoding; failures release buffers", async () => {
  const controller = new AbortController();
  const { api, calls, source } = canvasFixture({ onYield: () => controller.abort() });
  await assert.rejects(api.renderFlashLook(source, "35mm", 100, controller.signal), { name: "AbortError" });
  assert.equal(calls.encoded, 0); assert.equal(calls.canvas.width, 0);
  for (const options of [{ noContext: true }, { noBlob: true }]) {
    const fixture = canvasFixture(options);
    await assert.rejects(fixture.api.renderFlashLook(fixture.source, "noir", 100, new AbortController().signal));
    assert.equal(fixture.calls.canvas.width, 0);
  }
});
test("thumbnail and full export share the same pixel kernel, with a hard dimension ceiling", async () => {
  const { api, calls } = canvasFixture();
  await api.renderFlashLook({ width: 8000, height: 6000 }, "chrome", 100, new AbortController().signal, 9000);
  assert.deepEqual(calls.drawn[0].slice(1), [0, 0, 1600, 1200]);
  const expected = new Uint8ClampedArray(400 * 300 * 4).fill(128); gradeFlashPixels(expected, "chrome", 100);
  assert.deepEqual(calls.output, expected);
});
test("the maximum still-photo grade stays within a conservative CPU budget", () => {
  const pixels = new Uint8ClampedArray(1600 * 1600 * 4).fill(128);
  const started = performance.now(); gradeFlashPixels(pixels, "after-hours", 100);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, `2.56M pixels took ${elapsed.toFixed(0)} ms on this runner`);
  console.log(`Flash pixel kernel: ${elapsed.toFixed(1)} ms for 2.56M pixels (runner, not iPhone).`);
});
