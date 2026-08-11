import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("keeps the production Worker configuration portable and preserves The Room", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));

  assert.equal(config.legacy_env, undefined);
  assert.equal(config.configPath, undefined);
  assert.equal(config.userConfigPath, undefined);
  assert.deepEqual(config.routes, [{ pattern: "tickets.becoreops.com", custom_domain: true }]);
  assert.equal(config.r2_buckets, undefined);
  assert.deepEqual(config.durable_objects, { bindings: [{ name: "THE_ROOM", class_name: "TheRoom" }] });
  assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["TheRoom"] }]);
});

test("does not ship editor preview metadata or workspace paths in customer assets", async () => {
  const manifest = await readFile(new URL("../dist/client/.vite/manifest.json", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /codex-preview|\/workspace\/scratch|\.sites\//iu);
});

test("ships the BeCore Tickets tab icon in modern and fallback formats", async () => {
  const client = new URL("../dist/client/", import.meta.url);
  const svg = await readFile(new URL("favicon.svg", client), "utf8");

  assert.match(svg, /aria-label="BeCore Tickets"/u);
  assert.match(svg, /#ff5a1f/iu);
  assert.ok((await stat(new URL("favicon.ico", client))).size > 100);
  assert.ok((await stat(new URL("favicon-32x32.png", client))).size > 100);
  assert.ok((await stat(new URL("apple-touch-icon.png", client))).size > 100);
});
