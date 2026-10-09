import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { GET, PATCH } from '../app/api/customer/notifications/route';
import { hashToken } from '../lib/attendee-auth';

const origin = 'https://tickets.becoreops.com';
const originalReadAt = '2026-01-01T12:00:00.000Z';

beforeAll(async () => {
  // Isolated test instrumentation counts actual matched notification updates,
  // not final value differences or production/D1 index-inclusive billed rows.
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_notification_updates(attendee_id TEXT PRIMARY KEY, writes INTEGER NOT NULL DEFAULT 0)');
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS test_notification_update_count
    AFTER UPDATE OF read_at ON attendee_notifications BEGIN
      UPDATE test_notification_updates SET writes=writes+1 WHERE attendee_id=NEW.attendee_id;
    END`).run();
});

async function fixture(count = 1000, read = 980) {
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  const now = new Date().toISOString(), future = new Date(Date.now() + 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES(?,?,'Guest',?,'active',?,?)").bind(id, `${id}@example.com`, now, now, now),
    env.DB.prepare('INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(id, id, await hashToken(token), future, now, now),
    env.DB.prepare('INSERT INTO test_notification_updates(attendee_id) VALUES(?)').bind(id),
    env.DB.prepare(`INSERT INTO attendee_notifications(id,attendee_id,kind,title,body,url,created_at,read_at)
      SELECT value,?,'room_message','Room update','Synthetic test','/room/test',?,CASE WHEN key<? THEN ? ELSE NULL END
      FROM json_each(?)`).bind(id, now, read, originalReadAt, JSON.stringify(Array.from({ length: count }, (_, index) => `${id}/${index}`))),
  ]);
  const cookie = `bct_attendee=${token}`;
  return { id, cookie, patch: (body: unknown, requestOrigin = origin) => PATCH(new Request(`${origin}/api/customer/notifications`, {
    method: 'PATCH', headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })) };
}
const writes = async (id: string) => (await env.DB.prepare('SELECT writes FROM test_notification_updates WHERE attendee_id=?').bind(id).first<{ writes: number }>())!.writes;

it('updates only 20 unread rows out of 1,000 and makes lost-response retries write-free', async () => {
  const guest = await fixture();
  expect((await guest.patch({ all: true })).status).toBe(200);
  expect(await writes(guest.id)).toBe(20);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM attendee_notifications WHERE attendee_id=? AND read_at=?').bind(guest.id, originalReadAt).first()).toEqual({ count: 980 });
  const beforeRetry = (await env.DB.prepare('SELECT id,read_at FROM attendee_notifications WHERE attendee_id=? ORDER BY id').bind(guest.id).all()).results;
  // The server cannot know whether the previous 200 response reached an offline
  // client; replaying the same mutation must preserve the first-read timestamp.
  expect(await (await guest.patch({ all: true })).json()).toEqual({ updated: true });
  expect(await writes(guest.id)).toBe(20);
  expect((await env.DB.prepare('SELECT id,read_at FROM attendee_notifications WHERE attendee_id=? ORDER BY id').bind(guest.id).all()).results).toEqual(beforeRetry);
  const inbox = await GET(new Request(`${origin}/api/customer/notifications`, { headers: { cookie: guest.cookie } }));
  expect(inbox.status).toBe(200);
  expect(inbox.headers.get('cache-control')).toBe('no-store');
  expect(await inbox.json()).toMatchObject({ unread: 0 });
});

it('skips repeated single reads and cannot mark another attendee’s notification', async () => {
  const guest = await fixture(2, 1), other = await fixture(1, 0);
  expect((await guest.patch({ id: `${guest.id}/0` })).status).toBe(200);
  expect(await writes(guest.id)).toBe(0);
  expect((await guest.patch({ id: `${guest.id}/1` })).status).toBe(200);
  expect(await writes(guest.id)).toBe(1);
  expect((await guest.patch({ id: `${guest.id}/1` })).status).toBe(200);
  expect(await writes(guest.id)).toBe(1);
  expect((await guest.patch({ id: `${other.id}/0` })).status).toBe(200);
  expect(await writes(other.id)).toBe(0);
  expect(await env.DB.prepare('SELECT read_at FROM attendee_notifications WHERE id=?').bind(`${other.id}/0`).first()).toEqual({ read_at: null });
});

it('retains origin, session revocation and authentication guards before any notification write', async () => {
  const guest = await fixture(1, 0);
  expect((await guest.patch({ all: true }, 'https://other.example')).status).toBe(403);
  expect((await PATCH(new Request(`${origin}/api/customer/notifications`, { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) }))).status).toBe(401);
  await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(), guest.id).run();
  expect((await guest.patch({ all: true })).status).toBe(401);
  expect(await writes(guest.id)).toBe(0);
});
