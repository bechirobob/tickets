import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("keeps the production Worker configuration portable and preserves The Room", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));

  assert.equal(config.legacy_env, undefined);
  assert.equal(config.configPath, undefined);
  assert.equal(config.userConfigPath, undefined);
  assert.deepEqual(config.routes, [{ pattern: "tickets.becoreops.com", custom_domain: true }]);
  assert.deepEqual(config.triggers, { crons: ["*/5 * * * *", "15 3 * * *"] });
  assert.equal(config.vars.EMAIL_FROM, "BeCore Tickets <tickets@tickets.becoreops.com>");
  assert.equal(config.vars.OPS_ALERT_EMAIL, "tickets@becoreops.com");
  assert.equal(config.vars.ENVIRONMENT, "production");
  assert.deepEqual(config.ratelimits.map(({ name, simple }) => ({ name, simple })), [
    { name: "LOGIN_RATE_LIMITER", simple: { limit: 10, period: 60 } },
    { name: "PUBLIC_WRITE_RATE_LIMITER", simple: { limit: 12, period: 60 } },
    { name: "PAYMENT_RATE_LIMITER", simple: { limit: 10, period: 60 } },
    { name: "ANALYTICS_RATE_LIMITER", simple: { limit: 60, period: 60 } },
  ]);
  assert.deepEqual(config.observability, {
    enabled: true,
    logs: { enabled: true, head_sampling_rate: 1 },
    traces: { enabled: true, head_sampling_rate: 0.05 },
  });
  assert.deepEqual(config.images, { binding: "IMAGES" });
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.equal(config.r2_buckets, undefined);
  assert.deepEqual(config.durable_objects, { bindings: [{ name: "THE_ROOM", class_name: "TheRoom" }] });
  assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["TheRoom"] }]);
});

test("the Worker applies the production browser security baseline", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(worker, /Content-Security-Policy/u);
  assert.match(worker, /frame-ancestors 'none'/u);
  assert.match(worker, /'nonce-\$\{nonce\}' 'strict-dynamic'/u);
  assert.doesNotMatch(worker, /script-src[^;]*'unsafe-inline'/u);
  assert.match(worker, /style-src-attr 'unsafe-inline'/u);
  assert.match(worker, /Strict-Transport-Security/u);
  assert.match(worker, /X-Content-Type-Options/u);
  assert.match(worker, /Cross-Origin-Opener-Policy/u);
  assert.match(worker, /display-capture=\(\)/u);
  assert.match(worker, /recordSecurityEvent/u);
  assert.match(worker, /sendOperationalAlert/u);
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
