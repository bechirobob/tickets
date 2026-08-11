import { env } from "cloudflare:workers";
import { mutationHasValidOrigin } from "../../../../../../../lib/admin-session";
import { readAttendeeRoomAccess } from "../../../../../../../lib/attendee-auth";
import { FLASH_QUARANTINE_REPORT_COUNT } from "../../../../../../../lib/flashes";

type Context = { params: Promise<{ slug: string; id: string }> };
const reasons = new Set(["nonconsensual", "explicit", "unsafe", "spam", "other"]);

export async function POST(request: Request, context: Context) {
  const { slug, id } = await context.params;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This report was not accepted." }, { status: 403 });
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401 });
  const flash = await env.DB.prepare(`
    SELECT id, attendee_id AS attendeeId FROM room_flashes
    WHERE id = ? AND event_slug = ? AND status = 'active' AND expires_at > ? LIMIT 1
  `).bind(id, slug, new Date().toISOString()).first<{ id: string; attendeeId: string }>();
  if (!flash || flash.attendeeId === access.attendeeId) return Response.json({ error: "Flash not found." }, { status: 404 });
  const body = await request.json() as { reason?: string; details?: string };
  const reason = body.reason?.trim() ?? "";
  const details = body.details?.trim().slice(0, 500) || null;
  if (!reasons.has(reason)) return Response.json({ error: "Choose a report reason." }, { status: 400 });
  await env.DB.prepare(`
    INSERT INTO room_flash_reports (id, flash_id, event_slug, reporter_attendee_id, reason, details, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    ON CONFLICT(flash_id, reporter_attendee_id) DO NOTHING
  `).bind(crypto.randomUUID(), id, slug, access.attendeeId, reason, details, new Date().toISOString()).run();
  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM room_flash_reports WHERE flash_id = ? AND status = 'open'
  `).bind(id).first<{ count: number }>();
  if ((count?.count ?? 0) >= FLASH_QUARANTINE_REPORT_COUNT) {
    await env.DB.prepare(`UPDATE room_flashes SET status = 'hidden', moderation_result = 'reported' WHERE id = ? AND status = 'active'`).bind(id).run();
    await env.THE_ROOM.getByName(slug).removeFlash(id);
  }
  return Response.json({ reported: true }, { status: 201, headers: { "cache-control": "no-store" } });
}
