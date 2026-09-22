import { readAttendeeIdentity } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";
import { validPushEndpoint, validPushKeys } from '../../../../../lib/push-subscription';
import { enforceRateLimit } from '../../../../../lib/security-controls';

type SubscriptionInput = { confirmationUpdates?: boolean; hostUpdates?: boolean; roomUpdates?: boolean; endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get('endpoint');
  const device = endpoint ? await env.DB.prepare('SELECT confirmation_updates AS confirmations,room_updates AS rooms,host_updates AS hosts FROM push_subscriptions WHERE attendee_id=? AND endpoint=? AND revoked_at IS NULL').bind(identity.attendeeId, endpoint).first<{confirmations:number;rooms:number;hosts:number}>() : null;
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL")
    .bind(identity.attendeeId).first<{ count: number }>();
  return Response.json({ available: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT), deviceSubscribed: Boolean(device), roomUpdates: Boolean(device?.rooms), hostUpdates: Boolean(device?.hosts), confirmationUpdates: Boolean(device?.confirmations), publicKey: env.VAPID_PUBLIC_KEY ?? null, subscribedDevices: count?.count ?? 0 }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification request was not accepted." }, { status: 403 });
  if (!(await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `push-subscription:${identity.attendeeId}`))) return Response.json({ error: 'Give notifications a moment before trying again.' }, { status: 429 });
  const body = await request.json().catch(() => null) as SubscriptionInput | null;
  if (!body || typeof body.endpoint !== 'string' || typeof body.keys?.p256dh !== 'string' || typeof body.keys?.auth !== 'string') return Response.json({ error: 'That notification subscription is not valid.' }, { status: 400 });
  const endpoint = body.endpoint?.trim() ?? "";
  const p256dh = body.keys?.p256dh?.trim() ?? "";
  const auth = body.keys?.auth?.trim() ?? "";
  if (!validPushEndpoint(endpoint) || !validPushKeys(p256dh, auth)) {
    return Response.json({ error: "That notification subscription is not valid." }, { status: 400 });
  }
  for (const key of ['confirmationUpdates', 'hostUpdates', 'roomUpdates'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') return Response.json({ error: 'Choose a valid notification preference.' }, { status: 400 });
  }
  const legacyRoom = body.confirmationUpdates === undefined && body.hostUpdates === undefined && body.roomUpdates === undefined;
  const room = legacyRoom ? true : body.roomUpdates;
  const host = legacyRoom ? true : body.hostUpdates;
  if (!legacyRoom && [body.confirmationUpdates, host, room].includes(true) && !(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)) return Response.json({ error: 'Phone alerts are unavailable right now. Your updates stay in My Nights.' }, { status: 503 });
  const now = new Date().toISOString();
  const saved = await env.DB.prepare(`
    INSERT INTO push_subscriptions (id, attendee_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, failure_count, confirmation_updates, room_updates, host_updates)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL AND endpoint <> ?) < 12
    ON CONFLICT(endpoint) DO UPDATE SET
      room_updates = CASE WHEN ? IS NOT NULL THEN excluded.room_updates WHEN push_subscriptions.attendee_id = excluded.attendee_id THEN push_subscriptions.room_updates ELSE 0 END,
      host_updates = CASE WHEN ? IS NOT NULL THEN excluded.host_updates WHEN push_subscriptions.attendee_id = excluded.attendee_id THEN push_subscriptions.host_updates ELSE 0 END,
      confirmation_updates = CASE WHEN ? IS NOT NULL THEN excluded.confirmation_updates WHEN push_subscriptions.attendee_id = excluded.attendee_id THEN push_subscriptions.confirmation_updates ELSE 0 END,
      attendee_id = excluded.attendee_id,
      p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
      updated_at = excluded.updated_at, revoked_at = NULL, failure_count = 0
  `).bind(crypto.randomUUID(), identity.attendeeId, endpoint, p256dh, auth, request.headers.get("user-agent")?.slice(0, 300) ?? null, now, now, body.confirmationUpdates === true ? 1 : 0, room === true ? 1 : 0, host === true ? 1 : 0, identity.attendeeId, endpoint, room === undefined ? null : 1, host === undefined ? null : 1, body.confirmationUpdates === undefined ? null : 1).run();
  if (!saved.meta.changes) return Response.json({ error: 'You have notifications on 12 devices. Turn them off on an old device before adding another.' }, { status: 409 });
  return Response.json({ subscribed: true }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification request was not accepted." }, { status: 403 });
  const body = await request.json() as { endpoint?: string };
  await env.DB.prepare("UPDATE push_subscriptions SET revoked_at = ?, updated_at = ? WHERE attendee_id = ? AND endpoint = ?")
    .bind(new Date().toISOString(), new Date().toISOString(), identity.attendeeId, body.endpoint?.slice(0, 2000) ?? "").run();
  return Response.json({ subscribed: false }, { headers: { "cache-control": "no-store" } });
}
