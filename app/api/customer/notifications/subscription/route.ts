import { readAttendeeIdentity } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";

type SubscriptionInput = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL")
    .bind(identity.attendeeId).first<{ count: number }>();
  return Response.json({ available: Boolean(env.VAPID_PUBLIC_KEY), publicKey: env.VAPID_PUBLIC_KEY ?? null, subscribedDevices: count?.count ?? 0 }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification request was not accepted." }, { status: 403 });
  const body = await request.json() as SubscriptionInput;
  const endpoint = body.endpoint?.trim() ?? "";
  const p256dh = body.keys?.p256dh?.trim() ?? "";
  const auth = body.keys?.auth?.trim() ?? "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2000 || p256dh.length < 40 || p256dh.length > 300 || auth.length < 10 || auth.length > 100) {
    return Response.json({ error: "That notification subscription is not valid." }, { status: 400 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO push_subscriptions (id, attendee_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, failure_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET attendee_id = excluded.attendee_id,
      p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
      updated_at = excluded.updated_at, revoked_at = NULL, failure_count = 0
  `).bind(crypto.randomUUID(), identity.attendeeId, endpoint, p256dh, auth, request.headers.get("user-agent")?.slice(0, 300) ?? null, now, now).run();
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
