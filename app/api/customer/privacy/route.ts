import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../lib/admin-session";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  const settings = await env.DB.prepare("SELECT default_attendee_visible AS defaultAttendeeVisible, allow_host_updates AS allowHostUpdates FROM attendee_privacy_settings WHERE attendee_id = ? LIMIT 1").bind(identity.attendeeId).first<{ defaultAttendeeVisible: number; allowHostUpdates: number }>();
  return Response.json({ defaultAttendeeVisible: Boolean(settings?.defaultAttendeeVisible), allowHostUpdates: settings ? Boolean(settings.allowHostUpdates) : true }, { headers: { "cache-control": "no-store, private" } });
}

export async function PUT(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  const body = await request.json() as { defaultAttendeeVisible?: boolean; allowHostUpdates?: boolean };
  if (typeof body.defaultAttendeeVisible !== "boolean" || typeof body.allowHostUpdates !== "boolean") return Response.json({ error: "Choose both privacy settings." }, { status: 400 });
  await env.DB.prepare(`
    INSERT INTO attendee_privacy_settings (attendee_id, default_attendee_visible, allow_host_updates, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(attendee_id) DO UPDATE SET
      default_attendee_visible = excluded.default_attendee_visible,
      allow_host_updates = excluded.allow_host_updates,
      updated_at = excluded.updated_at
  `).bind(identity.attendeeId, body.defaultAttendeeVisible, body.allowHostUpdates, new Date().toISOString()).run();
  return Response.json({ saved: true });
}
