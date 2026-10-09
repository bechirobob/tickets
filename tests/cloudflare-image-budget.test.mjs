import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as imageOptimization from "vinext/server/image-optimization";
import { getImageProps, imageOptimizationUrl } from "vinext/shims/image";

// Node 22.13 does not enable native TypeScript stripping by default.
async function loadSupportModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const supportModule = { exports: {} };
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module: supportModule, exports: supportModule.exports,
    Request, Response, Headers, URL, TransformStream, crypto, btoa, console,
  });
  return supportModule.exports;
}

const [handoverControl, pageCache, security] = await Promise.all([
  "../worker/handover-control.ts", "../worker/public-page-cache.ts", "../worker/security-response.ts",
].map(loadSupportModule));

const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
const origin = "https://tickets.test";
const widths = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const unexpected = () => assert.fail("Image requests must not use unrelated Worker services");

// Run the actual Worker route and installed vinext validator with offline bindings.
// The app-router stub only proves delegation; it does not simulate its rendering.
function harness() {
  const calls = { assets: [], inputs: 0, transforms: [], outputs: [], appRouter: [] };
  const appRouter = { fetch(request) {
    calls.appRouter.push(request.url);
    return new Response("app-router", { status: 202 });
  } };
  const dependencies = {
    "./handover-control": handoverControl,
    "./public-page-cache": pageCache,
    "vinext/server/image-optimization": imageOptimization,
    "vinext/server/app-router-entry": { default: appRouter, __esModule: true },
    "./room-socket": { handleRoomSocket: unexpected },
    "./security-response": security,
    "../lib/admin-session": { recordSecurityEvent: unexpected, requestMetadata: unexpected },
    "./background": { processQueue: unexpected, runScheduledOperations: unexpected },
    "./the-room": {},
    "./handover": {},
  };
  const workerModule = { exports: {} };
  runInNewContext(compiled, {
    module: workerModule, exports: workerModule.exports, Request, Response, Headers, URL, console,
    caches: { default: { match: unexpected, put: unexpected } },
    require(specifier) {
      assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected import: ${specifier}`);
      return dependencies[specifier];
    },
  });
  const env = {
    RELEASE_SHA: "image-budget-test",
    ASSETS: { fetch(request) {
      calls.assets.push(request.url);
      return new Response("source-image", { headers: { "content-type": "image/png" } });
    } },
    IMAGES: { input(body) {
      assert.ok(body instanceof ReadableStream);
      calls.inputs++;
      return { transform(options) {
        calls.transforms.push({ ...options });
        return { output(options) {
          calls.outputs.push({ ...options });
          return { response: () => new Response("optimized-image", { headers: { "content-type": options.format } }) };
        } };
      } };
    } },
  };
  return {
    calls,
    fetch(path, accept) {
      const headers = accept ? { accept } : {};
      return workerModule.exports.default.fetch(new Request(new URL(path, origin), { headers }), env, { waitUntil: unexpected });
    },
  };
}

function legacyUrl(width = 640, quality = 75) {
  const url = new URL(imageOptimizationUrl("/events/poster.webp", width, quality), origin);
  url.pathname = "/_vinext/image";
  return url.pathname + url.search;
}

function assertNoImageWork(calls) {
  assert.deepEqual(calls.assets, []);
  assert.equal(calls.inputs, 0);
  assert.deepEqual(calls.transforms, []);
  assert.deepEqual(calls.outputs, []);
}

test("all 15 existing widths and AVIF, WebP, JPEG formats retain quality 75 and image headers", async () => {
  assert.deepEqual([...imageOptimization.DEFAULT_DEVICE_SIZES, ...imageOptimization.DEFAULT_IMAGE_SIZES].sort((a, b) => a - b), widths);
  const formats = [
    ["image/avif,image/webp,*/*", "image/avif"],
    ["image/webp,*/*", "image/webp"],
    [undefined, "image/jpeg"],
  ];
  const { fetch, calls } = harness();
  for (const width of widths) {
    for (const [accept, format] of formats) {
      const response = await fetch(legacyUrl(width), accept);
      assert.equal(response.status, 200, `${width} ${format}`);
      assert.equal(await response.text(), "optimized-image");
      assert.deepEqual(calls.transforms.at(-1), { width });
      assert.deepEqual(calls.outputs.at(-1), { format, quality: 75 });
      assert.equal(response.headers.get("content-type"), format);
      assert.equal(response.headers.get("cache-control"), imageOptimization.IMAGE_CACHE_CONTROL);
      assert.equal(response.headers.get("vary"), "Accept");
      assert.equal(response.headers.get("content-security-policy"), imageOptimization.IMAGE_CONTENT_SECURITY_POLICY);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("content-disposition"), "inline");
    }
  }
  assert.equal(calls.assets.length, 45);
  assert.ok(calls.assets.every(url => url === `${origin}/events/poster.webp`));
  assert.equal(calls.inputs, 45);
  assert.equal(calls.transforms.length, 45);
  assert.equal(calls.outputs.length, 45);
  assert.deepEqual(calls.appRouter, []);
});

test("every other numeric quality is rejected before asset fetch or billable transformation", async () => {
  const { fetch, calls } = harness();
  for (let quality = 1; quality <= 100; quality++) {
    if (quality === 75) continue;
    const response = await fetch(legacyUrl(640, quality), "image/avif");
    assert.equal(response.status, 400, `quality=${quality}`);
  }
  assertNoImageWork(calls);
  assert.deepEqual(calls.appRouter, []);
});

test("malformed, duplicate and unknown parameters still fail before image work", async () => {
  const { fetch, calls } = harness();
  const invalid = [];
  for (const [key, values] of [
    ["q", ["", "0", "101", "-1", "075", "75.0", "7.5e1", "75junk", " 75", "+75"]],
    ["w", ["", "0", "-1", "63", "4096", "0640", "640.0", "640junk"]],
    ["url", ["", "https://example.test/poster.webp", "//example.test/poster.webp"]],
  ]) {
    for (const value of values) {
      const url = new URL(legacyUrl(), origin);
      url.searchParams.set(key, value);
      invalid.push(url.pathname + url.search);
    }
    const missing = new URL(legacyUrl(), origin);
    missing.searchParams.delete(key);
    invalid.push(missing.pathname + missing.search);
  }
  for (const suffix of ["&q=75", "&q=100", "&w=640", "&url=%2Fevents%2Fother.webp", "&dpl=one&dpl=two", "&format=png"]) {
    invalid.push(legacyUrl() + suffix);
  }
  for (const path of invalid) {
    assert.equal((await fetch(path)).status, 400, path);
  }
  assertNoImageWork(calls);
  assert.deepEqual(calls.appRouter, []);
});

test("client-default quality and legacy deployment queries remain accepted without changing route ownership", async () => {
  const { fetch, calls } = harness();
  const current = imageOptimizationUrl("/events/poster.webp", 640);
  assert.equal(new URL(current, origin).pathname, "/_next/image");
  assert.equal(new URL(current, origin).searchParams.get("q"), "75");
  const props = getImageProps({ src: "/payment-providers/mtn.png", width: 30, height: 30, alt: "" }).props;
  for (const url of [props.src, ...props.srcSet.split(", ").map(candidate => candidate.split(" ")[0])]) {
    assert.equal(new URL(url, origin).searchParams.get("q"), "75");
  }
  // The existing client path and slashed aliases still go to the app router.
  for (const path of [current, current.replace("/_next/image?", "/_next/image/?"), legacyUrl().replace("/_vinext/image?", "/_vinext/image/?")]) {
    assert.equal((await fetch(path)).status, 202);
  }
  assert.equal(calls.appRouter.length, 3);
  assertNoImageWork(calls);
  for (const path of [legacyUrl(), legacyUrl() + "&dpl=older-deployment"]) {
    assert.equal((await fetch(path)).status, 200);
    assert.deepEqual(calls.outputs.at(-1), { format: "image/jpeg", quality: 75 });
  }
  assert.equal(calls.assets.length, 2);
  assert.ok(calls.assets.every(url => url === `${origin}/events/poster.webp`));
});
