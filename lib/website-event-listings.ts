// Temporary owner-requested website/PWA discovery exclusion, 22 October 2026.
// Keep publication, direct guest links, bookings, Room and staff access intact.
// Apply only at website listing boundaries, never to shared event retrieval or
// the packaged-app catalogue (which also supplies native direct event screens).
// To restore the listing, remove this slug from the set.
const temporarilyUnlisted = new Set(["sun-chasers-labadi"]);

export function isWebsiteListedEvent(event: { slug: string }): boolean {
  return !temporarilyUnlisted.has(event.slug);
}
