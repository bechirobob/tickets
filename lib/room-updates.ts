import { firstHostInboxVisibility } from "./room-host-first-post";
import { attendeeRoomAdmissionSource, hashToken, readCookie } from "./attendee-auth";
import { roomPolicyFromRecord, type RoomPolicyRecord } from "./room-policy";
import type { RoomUpdateSummary } from "./room-update-summary";

const updateKinds = "'room_message', 'host_update', 'host_first_post'";
const encoder = new TextEncoder();
const snapshotLifetime = 10 * 60_000;

// This projection deliberately never returns notification titles, bodies, senders,
// ticket details or attendee profiles. Admission is the same as Room entry.
export async function readRoomUpdateSummaries(db: D1Database, cookie: string | null): Promise<RoomUpdateSummary[]> {
  const token = readCookie(cookie);
  if (!token) return [];
  const now = new Date().toISOString();
  const rows = await db.prepare(`
    WITH admission AS MATERIALIZED (
      SELECT DISTINCT p.id AS attendeeId, t.event_slug AS eventSlug, s.expires_at AS sessionExpiresAt
      ${attendeeRoomAdmissionSource}
    )
    SELECT admission.eventSlug, admission.sessionExpiresAt, event.title,
      event.starts_at AS startsAt, event.ends_at AS endsAt,
      COALESCE(setting.emergency_read_only, 0) AS emergencyReadOnly,
      COALESCE(setting.slow_mode_seconds, 0) AS slowModeSeconds, setting.archived_at AS archivedAt,
      (SELECT COUNT(*) FROM attendee_notifications notice
        WHERE notice.attendee_id = admission.attendeeId AND notice.event_slug = admission.eventSlug
          AND notice.read_at IS NULL AND notice.kind IN (${updateKinds})
          AND (notice.kind<>'host_first_post' OR ${firstHostInboxVisibility.replaceAll('notification.', 'notice.')})) AS unread
    FROM admission JOIN curated_event_records event ON event.slug = admission.eventSlug
    LEFT JOIN room_settings setting ON setting.event_slug = event.slug
    WHERE event.archived_at IS NULL AND event.schedule_status = 'confirmed'
      AND (event.status = 'published' OR (event.status = 'scheduled' AND event.scheduled_publish_at <= ?))
    ORDER BY event.starts_at, event.slug
  `).bind(await hashToken(token), now, 1, 1, 1, now, now).all<RoomPolicyRecord & { eventSlug: string; unread: number; sessionExpiresAt: string }>();
  return rows.results.flatMap(row => {
    const policy = roomPolicyFromRecord(row.eventSlug, row);
    if (policy.archived) return [];
    return [{ eventSlug: row.eventSlug, title: row.title, unread: Number(row.unread),
      expiresAt: row.sessionExpiresAt < policy.readOnlyAt ? row.sessionExpiresAt : policy.readOnlyAt }];
  });
}

type Snapshot = { eventSlug: string; attendeeId: string; row: number; id: string; at: number };
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
function decode(value: string) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)); }
async function signingKey(cookie: string | null) {
  const token = readCookie(cookie);
  return token ? crypto.subtle.importKey('raw', encoder.encode(`room-update-snapshot:${token}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) : null;
}

// Captured before the client opens its Room socket, never when it merely visits
// the homepage. The sentinel prevents rowid reuse after deletion from clearing a
// newer notice. No new persistent credential, read ledger or schema is needed.
export async function captureRoomUpdateSnapshot(db: D1Database, cookie: string | null, eventSlug: string, attendeeId: string): Promise<string | null> {
  const key = await signingKey(cookie);
  if (!key) return null;
  const boundary = await db.prepare(`SELECT rowid AS row, id FROM attendee_notifications
    WHERE attendee_id = ? AND event_slug = ? AND kind IN (${updateKinds}) AND read_at IS NULL
    ORDER BY rowid DESC LIMIT 1`).bind(attendeeId, eventSlug).first<{ row: number; id: string }>();
  if (!boundary) return null;
  const payload = base64(encoder.encode(JSON.stringify({ ...boundary, attendeeId, eventSlug, at: Date.now() } satisfies Snapshot)));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64(new Uint8Array(signature))}`;
}

export async function acknowledgeRoomUpdateSnapshot(db: D1Database, cookie: string | null, eventSlug: string, snapshot: string): Promise<boolean> {
  const token = readCookie(cookie), key = await signingKey(cookie);
  if (!token || !key || snapshot.length > 2048) return false;
  let boundary: Snapshot;
  try {
    const [payload, signature, extra] = snapshot.split('.');
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', key, decode(signature), encoder.encode(payload))) return false;
    boundary = JSON.parse(new TextDecoder().decode(decode(payload))) as Snapshot;
    if (boundary.eventSlug !== eventSlug || typeof boundary.attendeeId !== 'string' || typeof boundary.id !== 'string'
      || !Number.isSafeInteger(boundary.row) || boundary.row <= 0 || !Number.isFinite(boundary.at)
      || Date.now() - boundary.at > snapshotLifetime || boundary.at > Date.now()) return false;
  } catch { return false; }
  // Admission is checked again inside the mutation's snapshot, not trusted from
  // the earlier access response. Only this attendee, event and captured notices.
  const now = new Date().toISOString();
  await db.prepare(`UPDATE attendee_notifications SET read_at = ?
    WHERE attendee_id = ? AND event_slug = ? AND kind IN (${updateKinds}) AND read_at IS NULL AND rowid <= ?
      AND EXISTS (SELECT 1 FROM attendee_notifications sentinel WHERE sentinel.rowid = ? AND sentinel.id = ?)
      AND EXISTS (SELECT 1 ${attendeeRoomAdmissionSource} AND t.event_slug = ? AND p.id = ?)
  `).bind(now, boundary.attendeeId, eventSlug, boundary.row, boundary.row, boundary.id,
    await hashToken(token), now, 1, 1, 1, eventSlug, boundary.attendeeId).run();
  return true;
}
