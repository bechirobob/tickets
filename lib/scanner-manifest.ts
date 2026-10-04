/** Offline admission is bounded by the staff session that downloaded the list.
 * Pending scan/review evidence is deliberately separate and is never erased here.
 */
export const GATE_MANIFEST_KEY = 'bct:gate-manifests:v2';
const ACCESS_KEY = 'bct:gate-access:v1';
const LEGACY_KEY = 'bct:gate-manifests:v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type GateAccess = { accountId: string; sessionId: string; expiresAt: number };
export type ManifestTicket = { ticketId: string; tokenHash: string; ticketType: string; status: string; attendeeName: string };
export type GateManifest = { eventSlug: string; generatedAt: string; access: GateAccess; tickets: ManifestTicket[] };

export function sameGateAccess(left: GateAccess | null | undefined, right: GateAccess): boolean {
  return Boolean(left && left.accountId === right.accountId && left.sessionId === right.sessionId && left.expiresAt === right.expiresAt);
}
export function clearGateManifests(storage: Storage, expectedAccess?: GateAccess) {
  // A stale scanner must not erase a newer scanner tab's verified session.
  if (expectedAccess && !sameGateAccess(JSON.parse(storage.getItem(ACCESS_KEY) ?? 'null'), expectedAccess)) return;
  storage.removeItem(ACCESS_KEY);
  storage.removeItem(GATE_MANIFEST_KEY);
  storage.removeItem(LEGACY_KEY);
}
export function beginGateAccess(storage: Storage, access: GateAccess) {
  let previous: GateAccess | null = null;
  try { previous = JSON.parse(storage.getItem(ACCESS_KEY) ?? 'null'); } catch { /* Discard unscoped lists. */ }
  if (!sameGateAccess(previous, access)) clearGateManifests(storage);
  storage.setItem(ACCESS_KEY, JSON.stringify(access));
}
export function readGateManifest(storage: Storage, access: GateAccess, eventSlug: string, now = Date.now()): GateManifest | null {
  try {
    if (now >= access.expiresAt * 1000 || !sameGateAccess(JSON.parse(storage.getItem(ACCESS_KEY) ?? 'null'), access)) return null;
    const value = JSON.parse(storage.getItem(GATE_MANIFEST_KEY) ?? '{}')[eventSlug] as GateManifest | undefined;
    const generated = Date.parse(value?.generatedAt ?? '');
    if (!value || value.eventSlug !== eventSlug || !sameGateAccess(value.access, access) || !Array.isArray(value.tickets)
      || value.tickets.some(ticket => !ticket || typeof ticket.ticketId !== 'string' || typeof ticket.tokenHash !== 'string'
        || typeof ticket.ticketType !== 'string' || typeof ticket.attendeeName !== 'string' || !['issued','checked_in'].includes(ticket.status))
      || !Number.isFinite(generated) || generated > now + 60_000 || now - generated >= 12 * 60 * 60 * 1000) return null;
    return value;
  } catch { return null; }
}
export function saveGateManifest(storage: Storage, access: GateAccess, manifest: GateManifest, now = Date.now()): boolean {
  // Logout, account change and an expired session win over a delayed response.
  if (now >= access.expiresAt * 1000 || !sameGateAccess(manifest.access, access)
    || !sameGateAccess(JSON.parse(storage.getItem(ACCESS_KEY) ?? 'null'), access)) return false;
  const all = JSON.parse(storage.getItem(GATE_MANIFEST_KEY) ?? '{}');
  all[manifest.eventSlug] = manifest;
  storage.setItem(GATE_MANIFEST_KEY, JSON.stringify(all));
  return true;
}
