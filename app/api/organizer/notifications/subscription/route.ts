import { readAdminSession, mutationHasValidOrigin } from '../../../../../lib/admin-session';
import { limitRequestBody } from '../../../../../lib/request-body';
import { validPushEndpoint, validPushKeys } from '../../../../../lib/push-subscription';
import { enforceRateLimit } from '../../../../../lib/security-controls';

const headers = { 'cache-control': 'no-store' };
async function context(request: Request) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session?.role === 'organizer' && !session.mustChangePassword ? session : null };
}
export async function GET(request: Request) {
  const { env, session } = await context(request);
  if (!session) return Response.json({ error: 'Sign in to your host account.' }, { status: 403, headers });
  const endpoint = new URL(request.url).searchParams.get('endpoint');
  const device = endpoint && await env.DB.prepare('SELECT id FROM organizer_push_subscriptions WHERE account_id=? AND session_id=? AND endpoint=? AND revoked_at IS NULL')
    .bind(session.accountId, session.sessionId, endpoint).first();
  return Response.json({ available: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT), publicKey: env.VAPID_PUBLIC_KEY ?? null, deviceSubscribed: Boolean(device) }, { headers });
}
async function mutate(request: Request, remove: boolean) {
  const bounded = await limitRequestBody(request);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  const { env, session } = await context(request);
  if (!session) return Response.json({ error: 'Sign in to your host account.' }, { status: 403, headers });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This request was not accepted.' }, { status: 403, headers });
  if (!await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `host-push:${session.accountId}`)) return Response.json({ error: 'Wait a moment and try again.' }, { status: 429, headers });
  const body = await request.json().catch(() => null) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!body || typeof body.endpoint !== 'string' || !validPushEndpoint(body.endpoint)) return Response.json({ error: 'Invalid notification subscription.' }, { status: 400, headers });
  const now = new Date().toISOString();
  if (remove) {
    await env.DB.prepare('UPDATE organizer_push_subscriptions SET revoked_at=?,updated_at=? WHERE account_id=? AND endpoint=?').bind(now, now, session.accountId, body.endpoint).run();
  } else {
    if (typeof body.keys?.p256dh !== 'string' || typeof body.keys?.auth !== 'string' || !validPushKeys(body.keys.p256dh, body.keys.auth)) return Response.json({ error: 'Invalid notification keys.' }, { status: 400, headers });
    if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)) return Response.json({ error: 'Phone alerts are unavailable. RSVP alerts use browser push only.' }, { status: 503, headers });
    // An expired/revoked session is no longer consent. Transfer only inactive
    // endpoints, atomically, so another signed-in host cannot steal a device.
    const result = await env.DB.prepare(`INSERT INTO organizer_push_subscriptions(id,account_id,session_id,endpoint,p256dh,auth,created_at,updated_at,consent_id)
      SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM organizer_push_subscriptions p
        JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id
        WHERE p.account_id=? AND p.revoked_at IS NULL AND p.endpoint<>? AND ss.revoked_at IS NULL AND ss.expires_at>?)<12
      ON CONFLICT(endpoint) DO UPDATE SET account_id=excluded.account_id,consent_id=excluded.consent_id,session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at,revoked_at=NULL
      WHERE organizer_push_subscriptions.account_id=excluded.account_id OR organizer_push_subscriptions.revoked_at IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM staff_sessions ss JOIN staff_accounts s ON s.id=ss.account_id
          WHERE ss.id=organizer_push_subscriptions.session_id AND ss.account_id=organizer_push_subscriptions.account_id
          AND ss.revoked_at IS NULL AND ss.expires_at>? AND s.status='active' AND s.role='organizer' AND s.must_change_password=0)`)
      .bind(crypto.randomUUID(),session.accountId,session.sessionId,body.endpoint,body.keys.p256dh,body.keys.auth,now,now,crypto.randomUUID(),session.accountId,body.endpoint,now,now).run();
    if (!result.meta.changes) return Response.json({ error: 'This device could not be added. Turn off alerts on an old device and try again.' }, { status: 409, headers });
  }
  return Response.json({ deviceSubscribed: !remove }, { headers });
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
