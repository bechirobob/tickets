/** Browser-local gate recovery. Never discard an entry until its result is durable. */
export const GATE_QUEUE_KEY = 'bct:gate-queue:v1';
export const GATE_REVIEW_KEY = 'bct:gate-review:v1';

export type GateTicket = { ticketId?: string; ticketType?: string; attendeeName?: string; checkedInAt?: string; checkedInGate?: string; eventSlug?: string; status?: string };
export type QueuedScan = { clientScanId: string; code: string; eventSlug: string; gate: string; deviceId: string; ticket: GateTicket; savedAt: string };
export type GateReview = { clientScanId: string; eventSlug: string; ticket: GateTicket; savedAt: string; reason: string; recordedAt: string; reviewedAt?: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function readGateList<T>(storage: Storage, key: string): T[] {
  const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object'
    || typeof item.clientScanId !== 'string' || typeof item.eventSlug !== 'string'
    || typeof item.savedAt !== 'string' || !item.ticket || typeof item.ticket !== 'object'
    || key === GATE_QUEUE_KEY && (typeof item.code !== 'string' || typeof item.deviceId !== 'string' || typeof item.gate !== 'string')
    || key === GATE_REVIEW_KEY && (typeof item.reason !== 'string' || typeof item.recordedAt !== 'string'))) {
    throw new Error('The saved door records could not be read. Ask a supervisor before clearing this device.');
  }
  return value as T[];
}

export function persistGateSync(storage: Storage, completed: Set<string>, reviews: GateReview[]) {
  const existing = readGateList<GateReview>(storage, GATE_REVIEW_KEY);
  const known = new Set(existing.map(item => item.clientScanId));
  const nextReviews = [...existing, ...reviews.filter(item => !known.has(item.clientScanId))];
  // Review first: if storage is full, unresolved entries stay in the retry queue.
  storage.setItem(GATE_REVIEW_KEY, JSON.stringify(nextReviews));
  // Read at commit time so entries scanned during synchronization are preserved.
  const remaining = readGateList<QueuedScan>(storage, GATE_QUEUE_KEY).filter(item => !completed.has(item.clientScanId));
  storage.setItem(GATE_QUEUE_KEY, JSON.stringify(remaining));
  return { remaining, reviews: nextReviews };
}

export function gateConnectionState(input: { online: boolean; reachable: boolean; lastContact: number; now: number; pending: number; reviews: number; syncing: boolean }) {
  if (!input.online) return 'offline';
  if (input.reviews) return 'review';
  if (input.syncing) return 'syncing';
  if (!input.reachable || !input.lastContact || input.now - input.lastContact > 30_000) return 'disconnected';
  if (input.pending) return 'pending';
  return 'connected';
}

export function selectedGateEvent(events: readonly { slug: string }[], requested?: string | null) {
  return events.some(event => event.slug === requested) ? requested! : events[0]?.slug ?? '';
}
