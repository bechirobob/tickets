export const OFFLINE_TICKETS_KEY = "bct:offline-tickets:v2";
const LEGACY_KEY = "bct:offline-tickets:v1";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export type OfflineNight = {
  slug: string; title: string; fullDate: string; time: string; venue: string; area: string;
  savedAt: string; expiresAt: string;
  tickets: Array<{ id: string; ticketType: string; gateCode: string; qrImage: string }>;
};
type OfflineWallet = { ownerId: string; nights: OfflineNight[] };

function read(storage: Storage, now: number): OfflineWallet | null {
  // Legacy copies have no owner or expiry. Rebuild them from verified access.
  storage.removeItem(LEGACY_KEY);
  const saved = JSON.parse(storage.getItem(OFFLINE_TICKETS_KEY) ?? "null") as OfflineWallet | null;
  if (!saved || typeof saved.ownerId !== "string" || !Array.isArray(saved.nights)) return null;
  saved.nights = saved.nights.filter((night) => Array.isArray(night.tickets)
    && Date.parse(night.expiresAt) > now && Date.parse(night.savedAt) > now - MAX_AGE);
  return saved;
}

export function clearOfflineTickets(storage?: Storage) {
  try {
    const target = storage ?? window.localStorage;
    target.removeItem(OFFLINE_TICKETS_KEY);
    target.removeItem(LEGACY_KEY);
  } catch { /* Storage may be disabled. Online tickets still work. */ }
}

export function reconcileOfflineTickets(ownerId: string, validTicketIds: string[], storage?: Storage, now = Date.now()) {
  try {
    const target = storage ?? window.localStorage;
    const saved = read(target, now);
    const valid = new Set(validTicketIds);
    const nights = saved?.ownerId === ownerId ? saved.nights.map((night) => ({
      ...night, tickets: night.tickets.filter((ticket) => valid.has(ticket.id)),
    })).filter((night) => night.tickets.length) : [];
    target.setItem(OFFLINE_TICKETS_KEY, JSON.stringify({ ownerId, nights }));
  } catch { clearOfflineTickets(storage); }
}

export function saveOfflineNight(ownerId: string, night: OfflineNight, storage?: Storage, now = Date.now()) {
  try {
    const target = storage ?? window.localStorage;
    const saved = read(target, now);
    // A sign-out or account change while QR generation was running must win.
    if (!saved || saved.ownerId !== ownerId) return;
    const nights = saved.nights.filter((item) => item.slug !== night.slug);
    if (night.tickets.length && Date.parse(night.expiresAt) > now) nights.unshift(night);
    target.setItem(OFFLINE_TICKETS_KEY, JSON.stringify({ ownerId, nights: nights.slice(0, 20) }));
  } catch { /* Quota failures must not break entry to the online wallet. */ }
}
