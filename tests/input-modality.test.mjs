import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = await readFile(new URL("../lib/input-modality.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
function fixture() {
  const document = new EventTarget();
  document.documentElement = { dataset: {} };
  document.hidden = false;
  const compiledModule = { exports: {} };
  runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports });
  const cleanup = compiledModule.exports.installInputModality(document);
  return { document, cleanup, mode: () => document.documentElement.dataset.inputModality,
    key(key, extra = {}) { const event = new Event("keydown"); Object.assign(event, { key, ...extra }); document.dispatchEvent(event); } };
}
test("pointer focus is local to modality, keyboard restores cues on hybrid/mobile devices", () => {
  const f = fixture();
  assert.equal(f.mode(), undefined);
  f.document.dispatchEvent(new Event("pointerdown"));
  assert.equal(f.mode(), "pointer");
  f.key("Shift"); assert.equal(f.mode(), "pointer");
  f.key("c", { ctrlKey: true }); assert.equal(f.mode(), "pointer");
  f.key("Tab"); assert.equal(f.mode(), "keyboard");
  f.document.dispatchEvent(new Event("pointerdown")); assert.equal(f.mode(), "pointer");
  f.key("ArrowRight"); assert.equal(f.mode(), "keyboard");
  f.document.dispatchEvent(new Event("pointerdown"));
  const click = new Event("click"); click.detail = 0; f.document.dispatchEvent(click);
  assert.equal(f.mode(), "pointer");
  f.key("Enter"); assert.equal(f.mode(), "keyboard");
  f.cleanup(); assert.equal(f.mode(), undefined);
  f.document.dispatchEvent(new Event("pointerdown")); assert.equal(f.mode(), undefined);
});
test("returning from hidden document retains native unknown-input defaults", () => {
  const f = fixture();
  f.document.dispatchEvent(new Event("pointerdown"));
  f.document.hidden = true; f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.mode(), undefined);
});
test("shared root installs policy without removing editing or keyboard focus", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/input-modality.css", import.meta.url), "utf8");
  assert.match(layout, /<InputModality \/>/);
  assert.match(layout, /styles\/input-modality.css/);
  assert.match(css, /html\[data-input-modality="pointer"\] :focus:not\(input, textarea, select, \[contenteditable\]:not\(\[contenteditable="false"\]\)\)/);
  assert.doesNotMatch(source, /\.blur\(|\.focus\(|preventDefault/);
  const room = await readFile(new URL("../app/room-features.css", import.meta.url), "utf8");
  assert.doesNotMatch(room, /\.chat-message-anchor\.is-active[^}]*outline:/);
});
