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

test("the final mobile cascade keeps the homepage hero inside the viewport", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(finalMobileBlock, /\.night-featured\s*\{[^}]*width:\s*calc\(100% - 32px\)/su);
  assert.match(finalMobileBlock, /\.night-hero__copy\s*\{[^}]*top:\s*178px/su);
  assert.match(finalMobileBlock, /\.night-ticker\s*\{[^}]*overflow:\s*hidden/su);
});
