import { env } from "cloudflare:workers";
import { mutationHasValidOrigin } from "../../../../../../lib/admin-session";
import { readAttendeeRoomAccess } from "../../../../../../lib/attendee-auth";
import { resolveRoomPolicy } from "../../../../../../lib/room-policy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string; id: string }> };

async function authorisedFlash(request: Request, slug: string, id: string) {
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return { access: null, flash: null };
  const flash = await env.DB.prepare(`
    SELECT flash.id, flash.attendee_id AS attendeeId, flash.object_key AS objectKey,
           flash.expires_at AS expiresAt, flash.status
    FROM room_flashes flash
    WHERE flash.id = ? AND flash.event_slug = ? AND flash.status = 'active' AND flash.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM room_blocks block
        WHERE block.event_slug = flash.event_slug AND block.blocker_attendee_id = ?
          AND block.blocked_attendee_id = flash.attendee_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM room_flash_reports report
        WHERE report.flash_id = flash.id AND report.reporter_attendee_id = ?
      )
    LIMIT 1
  `).bind(id, slug, new Date().toISOString(), access.attendeeId, access.attendeeId).first<{ id: string; attendeeId: string; objectKey: string; expiresAt: string; status: string }>();
  return { access, flash };
}

export async function GET(request: Request, context: Context) {
  const { slug, id } = await context.params;
  const policy = await resolveRoomPolicy(env.DB, slug);
  if (!policy || policy.readOnly) return new Response("Gone", { status: 410, headers: { "cache-control": "no-store" } });
  const { access, flash } = await authorisedFlash(request, slug, id);
  if (!access) return new Response("A valid ticket is required", { status: 401, headers: { "cache-control": "no-store" } });
  if (!flash) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const object = await env.FLASHES_BUCKET.get(flash.objectKey);
  if (!object) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(object.body, {
    headers: {
      "content-type": "image/webp",
      "content-length": String(object.size),
      "content-disposition": "inline; filename=flash.webp",
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
      "x-robots-tag": "noindex, noarchive, noimageindex",
    },
  });
}

export async function DELETE(request: Request, context: Context) {
  const { slug, id } = await context.params;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const { access, flash } = await authorisedFlash(request, slug, id);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401 });
  if (!flash || flash.attendeeId !== access.attendeeId) return Response.json({ error: "Flash not found." }, { status: 404 });
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE room_flashes SET status = 'deleted', moderation_result = 'owner_removed', deleted_at = ?
    WHERE id = ? AND attendee_id = ? AND status = 'active'
  `).bind(now, id, access.attendeeId).run();
  await env.FLASHES_BUCKET.delete(flash.objectKey);
  await env.THE_ROOM.getByName(slug).removeFlash(id);
  return Response.json({ removed: true }, { headers: { "cache-control": "no-store" } });
}
