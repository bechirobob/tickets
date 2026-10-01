export function requestNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function contentSecurityPolicy(nonce: string): string {
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; font-src 'self' data:; connect-src 'self' wss:; frame-src 'none'; media-src 'self' blob:; worker-src 'self' blob:`;
}

/** Only already-public, flat static artwork paths may be embedded by packaged clients.
 * API uploads, draft/private media, nested paths and encoded/traversal names stay private.
 * No CORS credentials or API access is granted by this resource-embedding policy.
 */
export function publicArtworkPath(path: string): boolean {
  return /^\/(?:events|hosts)\/[a-z0-9][a-z0-9_-]{0,119}\.(?:webp|png|jpe?g|avif)$/iu.test(path);
}

function publishedMediaResponse(response: Response, path: string): boolean {
  return /^\/api\/media\/[a-z0-9][a-z0-9_-]{0,119}$/iu.test(path)
    && response.status === 200
    && ["image/jpeg", "image/png", "image/webp"].includes(response.headers.get("content-type") ?? "")
    && response.headers.get("cache-control") === "public, max-age=0, must-revalidate"
    && response.headers.get("cross-origin-resource-policy") === "cross-origin"
    && !response.headers.has("set-cookie");
}

export function securityResponse(response: Response, nonce = requestNonce(), path = ""): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(self), display-capture=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (path === "/checkout-preview" || path.startsWith("/checkout-preview/") || path === "/api/payments/preview") {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (path === "/help" || path === "/organizer/submit" || path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/") || path === "/scan" || path.startsWith("/api/customer/") || path.startsWith("/api/organizer/") || path.startsWith("/organizer/workspace") || path.startsWith("/organizer/analytics") || path.startsWith("/organizer/assistant") || path.startsWith("/my-nights") || path.startsWith("/room/")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (path.startsWith("/organizer/join") || path.startsWith("/api/host-applications") || path === "/organizer/activate" || path === "/api/organizer/activate" || path === "/admin/recover" || path === "/api/admin/recovery" || path.startsWith("/announcements/") || path.startsWith("/api/announcements/") || path === "/my-nights/access" || path === "/rsvp/access" || path === "/payment/return" || path.startsWith("/api/customer/recovery") || path.startsWith("/api/customer/transfers/claim")) {
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", publicArtworkPath(path) || publishedMediaResponse(response, path) ? "cross-origin" : "same-origin");
  headers.delete("X-Powered-By");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

