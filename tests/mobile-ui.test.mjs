import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const roomUrl = new URL("../app/room/[slug]/room-client.tsx", import.meta.url);

test("message controls cannot inherit a full-page footer layout", async () => {
  const [css, room] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(roomUrl, "utf8"),
  ]);

  assert.doesNotMatch(css, /(?:^|\n)footer\s*\{/u);
  assert.match(room, /className="room-message__actions"/u);
  assert.doesNotMatch(room, /<footer>\s*<button/u);
  assert.match(css, /\.room-bubble\s*\{[^}]*border-radius:/su);
});

test("Room text controls keep iOS at the existing page scale", async () => {
  const css = await readFile(cssUrl, "utf8");
  const roomMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 640px)"));

  assert.match(css, /\.room-composer textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.match(roomMobileBlock, /\.room-stream\s*\{[^}]*min-height:\s*0/su);
  assert.match(roomMobileBlock, /\.room-modal select,\s*\.room-modal textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.doesNotMatch(css, /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/u);
});

test("the final mobile cascade keeps the homepage hero inside the viewport", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(finalMobileBlock, /\.night-featured\s*\{[^}]*width:\s*calc\(100% - 32px\)/su);
  assert.match(finalMobileBlock, /\.night-hero__copy\s*\{[^}]*top:\s*178px/su);
  assert.match(finalMobileBlock, /\.night-ticker\s*\{[^}]*overflow:\s*hidden/su);
});

test("customer actions are editorial links and the mobile event list is a smooth snap rail", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(css, /\.night-submit\s*\{[^}]*border-bottom:[^}]*color:\s*white/su);
  assert.match(css, /\.night-shuffle\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--signal\)/su);
  assert.match(css, /\.vibe-filter button\.active\s*\{[^}]*background:\s*transparent/su);
  assert.match(finalMobileBlock, /\.curated-grid\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory[^}]*scroll-behavior:\s*smooth/su);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});
