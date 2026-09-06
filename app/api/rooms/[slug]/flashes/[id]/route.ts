import { env } from "cloudflare:workers";
import { mutationHasValidOrigin } from "../../../../../../lib/admin-session";
import { readAttendeeRoomAccess } from "../../../../../../lib/attendee-auth";
import { resolveRoomPolicy } from "../../../../../../lib/room-policy";

import { FLASH_VIEW_DURATION_MS } from "../../../../../../lib/flashes";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string; id: string }> };

async function authorisedFlash(request: Request, slug: string, id: string) {
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return { access: null, flash: null };
  const flash = await env.DB.prepare(`
    SELECT flash.id, flash.attendee_id AS attendeeId, flash.image_data AS imageData,
           flash.content_type AS contentType, flash.expires_at AS expiresAt, flash.status
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
  `).bind(id, slug, new Date().toISOString(), access.attendeeId, access.attendeeId).first<{ id: string; attendeeId: string; imageData: number[] | null; contentType: string; expiresAt: string; status: string }>();
  return { access, flash };
}

const privateHeaders = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, noarchive" };
const viewIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request, context: Context) {
  const { slug, id } = await context.params;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403, headers: privateHeaders });
  const body = await request.json().catch(() => null) as { viewId?: unknown } | null;
  if (typeof body?.viewId !== "string" || !viewIdPattern.test(body.viewId)) return Response.json({ error: "A viewing session is required." }, { status: 400, headers: privateHeaders });
  const { access, flash } = await authorisedFlash(request, slug, id);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401, headers: privateHeaders });
  const policy = await resolveRoomPolicy(env.DB, slug);
  if (!flash?.imageData || !policy || policy.readOnly) return Response.json({ error: "This Flash has left the Room." }, { status: 410, headers: privateHeaders });
  const now = Date.now();
  const until = new Date(Math.min(now + FLASH_VIEW_DURATION_MS, Date.parse(flash.expiresAt), Date.parse(policy.readOnlyAt))).toISOString();
  // The unique guest/Flash key arbitrates simultaneous opens. A network retry
  // may resume its original nonce, but can never extend that session's deadline.
  await env.DB.prepare(`INSERT INTO room_flash_views (flash_id, attendee_id, view_id, opened_at, view_until)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(flash_id, attendee_id) DO NOTHING`)
    .bind(id, access.attendeeId, body.viewId, new Date(now).toISOString(), until).run();
  if (flash.attendeeId === access.attendeeId) {
    // Senders can preview their own photo. A new preview replaces any old lease.
    await env.DB.prepare(`UPDATE room_flash_views SET view_id = ?, opened_at = ?, view_until = ?
      WHERE flash_id = ? AND attendee_id = ? AND view_id != ?`)
      .bind(body.viewId, new Date(now).toISOString(), until, id, access.attendeeId, body.viewId).run();
  }
  const view = await env.DB.prepare(`SELECT view_id AS viewId, opened_at AS openedAt, view_until AS viewUntil
    FROM room_flash_views WHERE flash_id = ? AND attendee_id = ?`)
    .bind(id, access.attendeeId).first<{ viewId: string; openedAt: string; viewUntil: string }>();
  const remainingMs = view ? Date.parse(view.viewUntil) - Date.now() : 0;
  if (!view || view.viewId !== body.viewId || remainingMs <= 0) return Response.json({ error: "Already opened. Some things belong to the moment." }, { status: 410, headers: privateHeaders });
  return Response.json({ imageUrl: `/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(id)}?view=${encodeURIComponent(view.viewId)}`, openedAt: view.openedAt, remainingMs }, { headers: privateHeaders });
}

export async function PATCH(request: Request, context: Context) {
  const { slug, id } = await context.params;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403, headers: privateHeaders });
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401, headers: privateHeaders });
  const body = await request.json().catch(() => null) as { viewId?: unknown } | null;
  if (typeof body?.viewId !== "string" || !viewIdPattern.test(body.viewId)) return Response.json({ error: "A viewing session is required." }, { status: 400, headers: privateHeaders });
  await env.DB.prepare(`UPDATE room_flash_views SET view_until = MIN(view_until, ?)
    WHERE flash_id = ? AND attendee_id = ? AND view_id = ?
      AND EXISTS (SELECT 1 FROM room_flashes WHERE id = ? AND event_slug = ?)`)
    .bind(new Date().toISOString(), id, access.attendeeId, body.viewId, id, slug).run();
  return Response.json({ closed: true }, { headers: privateHeaders });
}

export async function GET(request: Request, context: Context) {
  const { slug, id } = await context.params;
  const policy = await resolveRoomPolicy(env.DB, slug);
  if (!policy || policy.readOnly) return new Response("Gone", { status: 410, headers: { "cache-control": "no-store" } });
  const { access, flash } = await authorisedFlash(request, slug, id);
  if (!access) return new Response("A valid ticket is required", { status: 401, headers: { "cache-control": "no-store" } });
  if (!flash?.imageData) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const viewId = new URL(request.url).searchParams.get("view") ?? "";
  const view = viewIdPattern.test(viewId) ? await env.DB.prepare(`SELECT 1 AS allowed FROM room_flash_views
    WHERE flash_id = ? AND attendee_id = ? AND view_id = ? AND view_until > ?`)
    .bind(id, access.attendeeId, viewId, new Date().toISOString()).first() : null;
  if (!view) return new Response("This viewing session has ended", { status: 410, headers: privateHeaders });
  const image = Uint8Array.from(flash.imageData);
  return new Response(image, {
    headers: {
      "content-type": flash.contentType,
      "content-length": String(image.byteLength),
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
  const removed = await env.DB.prepare(`
    UPDATE room_flashes SET image_data = NULL, status = 'deleted', moderation_result = 'owner_removed', deleted_at = ?
    WHERE id = ? AND attendee_id = ? AND status = 'active'
  `).bind(now, id, access.attendeeId).run();
  if ((removed.meta.changes ?? 0) !== 1) return Response.json({ error: "Flash not found." }, { status: 404 });
  try {
    await env.THE_ROOM.getByName(slug).removeFlash(id);
  } catch (error) {
    console.error(JSON.stringify({ message: "flash removal broadcast failed", flashId: id, eventSlug: slug, error: error instanceof Error ? error.message : String(error) }));
  }
  return Response.json({ removed: true }, { headers: { "cache-control": "no-store" } });
}
