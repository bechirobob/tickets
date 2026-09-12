import { expect, it } from "vitest";
import { publicCacheResponse, publicPageCacheKey } from "../worker/public-page-cache";

it("never serves a previous release's cached asset references after a deployment", async () => {
  const request = new Request("https://cache-test.example/hosts", { headers: { accept: "text/html" } });
  const oldKey = publicPageCacheKey(request, new URL(request.url), "previous-worker-version")!;
  const newKey = publicPageCacheKey(request, new URL(request.url), "new-worker-version")!;
  const cache = (caches as CacheStorage & { readonly default: Cache }).default;
  await cache.put(oldKey, publicCacheResponse(new Response('<script src="/old-release.js"></script>'), "MISS"));
  try {
    expect(await (await cache.match(oldKey))?.text()).toContain("old-release.js");
    expect(await cache.match(newKey)).toBeUndefined();
  } finally {
    await cache.delete(oldKey);
  }
});

it("keeps private, query-specific and unidentified-release requests outside the page cache", () => {
  for (const path of ["/my-nights", "/api/customer/registrations", "/admin/orders", "/events?date=2026-09-20"]) {
    const request = new Request(`https://cache-test.example${path}`, { headers: { accept: "text/html" } });
    expect(publicPageCacheKey(request, new URL(request.url), "release")).toBeNull();
  }
  const request = new Request("https://cache-test.example/", { headers: { accept: "text/html" } });
  expect(publicPageCacheKey(request, new URL(request.url), undefined)).toBeNull();
});

it("requires browser HTML revalidation while preserving a short edge TTL and removing cookies", () => {
  const response = publicCacheResponse(new Response("page", { headers: { "set-cookie": "private=value" } }), "HIT");
  expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=45");
  expect(response.headers.has("set-cookie")).toBe(false);
});
