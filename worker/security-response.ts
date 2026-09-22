export function requestNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function contentSecurityPolicy(nonce: string): string {
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; font-src 'self' data:; connect-src 'self' wss:; frame-src 'none'; media-src 'self' blob:; worker-src 'self' blob:`;
}

export function securityResponse(response: Response, nonce = requestNonce(), path = ""): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(self), display-capture=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (path === "/help" || path === "/organizer/submit" || path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/") || path === "/scan" || path.startsWith("/api/customer/") || path.startsWith("/api/organizer/") || path.startsWith("/organizer/workspace") || path.startsWith("/organizer/analytics") || path.startsWith("/organizer/assistant") || path.startsWith("/my-nights") || path.startsWith("/room/")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (path === "/organizer/activate" || path === "/api/organizer/activate" || path === "/admin/recover" || path === "/api/admin/recovery" || path.startsWith("/announcements/") || path.startsWith("/api/announcements/") || path === "/my-nights/access" || path === "/rsvp/access" || path === "/payment/return" || path.startsWith("/api/customer/recovery") || path.startsWith("/api/customer/transfers/claim")) {
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.delete("X-Powered-By");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

