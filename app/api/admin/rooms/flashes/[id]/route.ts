import { env } from "cloudflare:workers";
import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../../../lib/admin-session";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function moderator(request: Request) {
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return session && hasPermission(session, "rooms.moderate") ? session : null;
}

async function findFlash(id: string) {
  return env.DB.prepare(`
    SELECT id, event_slug AS eventSlug, object_key AS objectKey, status, expires_at AS expiresAt
    FROM room_flashes WHERE id = ? AND status != 'deleted' AND expires_at > ? LIMIT 1
  `).bind(id, new Date().toISOString()).first<{ id: string; eventSlug: string; objectKey: string; status: string; expiresAt: string }>();
}

export async function GET(request: Request, context: Context) {
  const session = await moderator(request);
  if (!session) return new Response("Administrator access required", { status: 401 });
  const flash = await findFlash((await context.params).id);
  if (!flash) return new Response("Not found", { status: 404 });
  if (!(await hasEventAssignment(env.DB, session, flash.eventSlug))) return new Response("Forbidden", { status: 403 });
  const object = await env.FLASHES_BUCKET.get(flash.objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": "image/webp", "cache-control": "private, no-store", "content-disposition": "inline; filename=moderation-flash.webp", "x-robots-tag": "noindex, noarchive, noimageindex" } });
}

export async function DELETE(request: Request, context: Context) {
  const session = await moderator(request);
  if (!session) return Response.json({ error: "Administrator access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const flash = await findFlash((await context.params).id);
  if (!flash) return Response.json({ error: "Flash not found." }, { status: 404 });
  if (!(await hasEventAssignment(env.DB, session, flash.eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE room_flashes SET status = 'deleted', moderation_result = 'moderator_removed', deleted_at = ? WHERE id = ?`).bind(now, flash.id),
    env.DB.prepare(`UPDATE room_flash_reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE flash_id = ? AND status = 'open'`).bind(now, session.actor, flash.id),
    env.DB.prepare(`
      INSERT INTO room_moderation_actions (id, event_slug, actor, action, message_id, note, created_at)
      VALUES (?, ?, ?, 'remove_flash', ?, 'Removed after attendee report', ?)
    `).bind(crypto.randomUUID(), flash.eventSlug, session.actor, flash.id, now),
  ]);
  await env.FLASHES_BUCKET.delete(flash.objectKey);
  await env.THE_ROOM.getByName(flash.eventSlug).removeFlash(flash.id);
  await recordAudit(env.DB, { session, action: "room.flash_removed", targetType: "room_flash", targetId: flash.id, outcome: "success", detail: flash.eventSlug, requestId: requestMetadata(request).requestId });
  return Response.json({ removed: true });
}
