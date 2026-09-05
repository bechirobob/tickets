const CACHE = "becore-tickets-shell-v2";
const SHELL = ["/offline-ticket.html", "/manifest.webmanifest", "/favicon.svg", "/apple-touch-icon.png"];

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
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline-ticket.html")));
  }
});
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "The Room moved", {
    body: data.body || "Open My Nights to see what happened.",
    icon: "/apple-touch-icon.png",
    badge: "/favicon-32x32.png",
    tag: data.tag || "becore-tickets",
    renotify: false,
    data: { url: data.url || "/notifications", eventSlug: data.eventSlug || null },
    actions: data.eventSlug ? [{ action: "open", title: "Open The Room" }, { action: "quiet", title: "Quiet this Room" }] : [{ action: "open", title: "Open My Nights" }],
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const eventSlug = event.notification.data?.eventSlug;
  const target = event.action === "quiet" && eventSlug
    ? `/notifications?mute=${encodeURIComponent(eventSlug)}`
    : event.notification.data?.url || "/notifications";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) { existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});
