const PUBLIC_PAGE_CACHE_SECONDS = 45;

export function publicPageCacheKey(request: Request, url: URL, release: string | undefined): Request | null {
  if (!release || request.method !== "GET" || url.search || !request.headers.get("accept")?.includes("text/html")) return null;
  const path = url.pathname;
  const eligible = path === "/" || path === "/about" || path === "/events" || path === "/hosts"
    || /^\/event\/[a-z0-9-]{1,80}$/u.test(path)
    || /^\/hosts\/[a-z0-9-]{1,80}$/u.test(path);
  if (!eligible) return null;
  // HTML references content-hashed assets belonging to this Worker version.
  // Reusing another release's HTML can request assets that are no longer served.
  const key = new URL(path, url.origin);
  key.searchParams.set("__becore_release", release);
  return new Request(key, { method: "GET", headers: { accept: "text/html" } });
}

export function publicCacheResponse(response: Response, state: "HIT" | "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  // Browsers revalidate HTML; the release-scoped edge cache keeps its short TTL.
  headers.set("cache-control", `public, max-age=0, s-maxage=${PUBLIC_PAGE_CACHE_SECONDS}`);
  headers.set("x-becore-edge-cache", state);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
