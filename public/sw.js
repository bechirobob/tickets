const CACHE = "becore-tickets-shell-v6";
// Cache the host's canonical URL, rather than a redirected .html response.
const OFFLINE_PAGE = "/offline-ticket";
const SHELL = [OFFLINE_PAGE, "/manifest.webmanifest", "/favicon.svg", "/apple-touch-icon.png", "/brand/becore-ticket.webp"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === OFFLINE_PAGE || url.pathname === "/offline-ticket.html") {
    event.respondWith(caches.match(OFFLINE_PAGE).then((cached) => cached || fetch(event.request)));
    return;
  }
  if (url.pathname === "/brand/becore-ticket.webp") {
    event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_PAGE)));
  }
});
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "The Room moved", {
    body: data.body || "Open My Nights to see what happened.",
    icon: "/apple-touch-icon.png?v=5",
    badge: "/favicon-32x32.png?v=5",
    tag: data.tag || "becore-tickets",
    renotify: false,
    data: { url: data.url || "/notifications", eventSlug: data.eventSlug || null },
    actions: data.eventSlug ? [{ action: "open", title: "Open The Room" }, { action: "quiet", title: "Quiet this Room" }] : [{ action: "open", title: "Open My Nights" }],
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const eventSlug = event.notification.data?.eventSlug;
  let target = "/notifications";
  try {
    const candidate = new URL(event.notification.data?.url || "/notifications", self.location.origin);
    if (candidate.origin === self.location.origin && /^\/(?:notifications|my-nights|event|events|room|tickets|hosts)(?:\/|$)/u.test(candidate.pathname)) target = candidate.pathname + candidate.search + candidate.hash;
  } catch { /* Invalid payloads open the inbox. */ }
  if (event.action === "quiet" && typeof eventSlug === "string" && /^[a-z0-9-]{1,80}$/u.test(eventSlug)) target = `/notifications?mute=${encodeURIComponent(eventSlug)}`;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client && !/\/(?:admin|organizer|scan)(?:\/|$)/u.test(new URL(client.url).pathname));
    if (existing) return existing.navigate(target).then((navigated) => navigated ? navigated.focus() : self.clients.openWindow(target));
    return self.clients.openWindow(target);
  }));
});
