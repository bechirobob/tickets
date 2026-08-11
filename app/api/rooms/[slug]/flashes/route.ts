import { env } from "cloudflare:workers";
import { mutationHasValidOrigin, recordSecurityEvent, requestMetadata } from "../../../../../lib/admin-session";
import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";
import {
  FLASH_MAX_ACTIVE_PER_EVENT,
  FLASH_MAX_ACTIVE_PER_ATTENDEE,
  FLASH_MAX_ACTIVE_STORAGE_BYTES,
  FLASH_MAX_STORED_BYTES,
  FLASH_MAX_UPLOAD_BYTES,
  FLASH_OUTPUT_CONTENT_TYPE,
  hasAcceptedFlashType,
  hasValidFlashSignature,
  moderateFlashImage,
  scaledFlashDimensions,
  type FlashRecord,
} from "../../../../../lib/flashes";
import { resolveRoomPolicy } from "../../../../../lib/room-policy";
import { enforceRateLimit } from "../../../../../lib/security-controls";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

function validSlug(value: string): boolean {
  return /^[a-z0-9-]{1,80}$/u.test(value);
}

function flashHeaders(): HeadersInit {
  return { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, noarchive" };
}

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  if (!validSlug(slug)) return Response.json({ error: "Event not found." }, { status: 404, headers: flashHeaders() });
  const [access, policy] = await Promise.all([
    readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug),
    resolveRoomPolicy(env.DB, slug),
  ]);
  if (!access || !policy) return Response.json({ error: "A valid ticket is required." }, { status: 401, headers: flashHeaders() });
  if (policy.readOnly) return Response.json({ flashes: [], expiresAt: policy.readOnlyAt }, { headers: flashHeaders() });

  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`
    SELECT flash.id, flash.event_slug AS eventSlug, flash.attendee_id AS attendeeId,
           profile.display_name AS displayName, flash.width, flash.height,
           flash.created_at AS createdAt, flash.expires_at AS expiresAt
    FROM room_flashes flash
    JOIN attendee_profiles profile ON profile.id = flash.attendee_id
    WHERE flash.event_slug = ? AND flash.status = 'active' AND flash.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM room_blocks block
        WHERE block.event_slug = flash.event_slug AND block.blocker_attendee_id = ?
          AND block.blocked_attendee_id = flash.attendee_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM room_flash_reports report
        WHERE report.flash_id = flash.id AND report.reporter_attendee_id = ?
      )
    ORDER BY flash.created_at DESC
    LIMIT 100
  `).bind(slug, now, access.attendeeId, access.attendeeId).all<Omit<FlashRecord, "mine">>();
  return Response.json({
    flashes: rows.results.map((flash) => ({ ...flash, mine: flash.attendeeId === access.attendeeId })),
    expiresAt: policy.readOnlyAt,
  }, { headers: flashHeaders() });
}

export async function POST(request: Request, context: Context) {
  const { slug } = await context.params;
  if (!validSlug(slug)) return Response.json({ error: "Event not found." }, { status: 404 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This Flash was not accepted." }, { status: 403 });
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > FLASH_MAX_UPLOAD_BYTES + 512_000) {
    return Response.json({ error: "Choose a photo under 6 MB." }, { status: 413 });
  }

  const [access, policy] = await Promise.all([
    readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug),
    resolveRoomPolicy(env.DB, slug),
  ]);
  if (!access || !policy) return Response.json({ error: "A valid ticket is required." }, { status: 401 });
  if (policy.readOnly) return Response.json({ error: "This Room has closed. Its Flashes are gone." }, { status: 410 });
  if (!(await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `flash:${access.attendeeId}`))) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: access.attendeeId, path: new URL(request.url).pathname, requestId: requestMetadata(request).requestId });
    return Response.json({ error: "Give the Room a moment before sharing another Flash." }, { status: 429 });
  }

  const active = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM room_flashes
    WHERE event_slug = ? AND attendee_id = ? AND status = 'active' AND expires_at > ?
  `).bind(slug, access.attendeeId, new Date().toISOString()).first<{ count: number }>();
  if ((active?.count ?? 0) >= FLASH_MAX_ACTIVE_PER_ATTENDEE) {
    return Response.json({ error: "You have 8 live Flashes in this Room. Remove one before sharing another." }, { status: 409 });
  }

  const capacity = await env.DB.prepare(`
    SELECT COUNT(CASE WHEN event_slug = ? THEN 1 END) AS eventCount,
           COALESCE(SUM(byte_size), 0) AS storedBytes
    FROM room_flashes
    WHERE status = 'active' AND expires_at > ? AND image_data IS NOT NULL
  `).bind(slug, new Date().toISOString()).first<{ eventCount: number; storedBytes: number }>();
  if ((capacity?.eventCount ?? 0) >= FLASH_MAX_ACTIVE_PER_EVENT) {
    return Response.json({ error: "This Room's Flashes are full for the moment." }, { status: 409 });
  }
  if ((capacity?.storedBytes ?? 0) >= FLASH_MAX_ACTIVE_STORAGE_BYTES) {
    return Response.json({ error: "Flashes are at their temporary storage limit. Try again after older moments clear." }, { status: 507 });
  }

  const form = await request.formData();
  const photo = form.get("photo");
  const consent = String(form.get("consent") ?? "") === "yes";
  if (!(photo instanceof File) || photo.size === 0 || !consent) {
    return Response.json({ error: "Choose a photo and confirm everyone pictured is comfortable with it being shared." }, { status: 400 });
  }
  if (photo.size > FLASH_MAX_UPLOAD_BYTES || !hasAcceptedFlashType(photo.type)) {
    return Response.json({ error: "Flashes must be JPG, PNG or WebP photos under 6 MB." }, { status: 400 });
  }
  const signature = new Uint8Array(await photo.slice(0, 16).arrayBuffer());
  if (!hasValidFlashSignature(signature, photo.type)) {
    return Response.json({ error: "That file does not match its image format." }, { status: 400 });
  }

  let info: ImageInfoResponse;
  try {
    info = await env.IMAGES.info(photo.stream());
  } catch {
    return Response.json({ error: "That photo could not be read. Try a JPG, PNG or WebP." }, { status: 400 });
  }
  if (!("width" in info) || info.format === "image/svg+xml") {
    return Response.json({ error: "Choose a JPG, PNG or WebP photo." }, { status: 400 });
  }
  if (info.width < 160 || info.height < 160 || info.width > 12000 || info.height > 12000) {
    return Response.json({ error: "Choose a clear photo between 160 and 12,000 pixels." }, { status: 400 });
  }

  const moderationPreview = await env.IMAGES.input(photo.stream())
    .transform({ width: 512, height: 512, fit: "scale-down" })
    .output({ format: FLASH_OUTPUT_CONTENT_TYPE, quality: 68, anim: false });
  const moderationBytes = new Uint8Array(await moderationPreview.response().arrayBuffer());
  const moderation = await moderateFlashImage(env.AI, moderationBytes);
  await env.DB.prepare(`
    INSERT INTO room_flash_moderation_events (id, event_slug, attendee_id, outcome, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), slug, access.attendeeId, moderation, moderation === "allowed" ? null : "automated_safety_review", new Date().toISOString()).run();
  if (moderation === "blocked") return Response.json({ error: "This photo cannot be shared in Flashes." }, { status: 422 });
  if (moderation === "unavailable") return Response.json({ error: "The safety check is taking a break. Try this Flash again shortly." }, { status: 503 });

  const id = crypto.randomUUID();
  const dimensions = scaledFlashDimensions(info.width, info.height, 1280);
  const transformed = await env.IMAGES.input(photo.stream())
    .transform({ width: 1280, height: 1280, fit: "scale-down" })
    .output({ format: FLASH_OUTPUT_CONTENT_TYPE, quality: 72, anim: false });
  const transformedResponse = transformed.response();
  const imageBytes = new Uint8Array(await transformedResponse.arrayBuffer());
  if (imageBytes.length === 0 || imageBytes.length > FLASH_MAX_STORED_BYTES) {
    return Response.json({ error: "That photo stays too large after preparation. Try a closer crop or a simpler image." }, { status: 413 });
  }
  if ((capacity?.storedBytes ?? 0) + imageBytes.length > FLASH_MAX_ACTIVE_STORAGE_BYTES) {
    return Response.json({ error: "Flashes are at their temporary storage limit. Try again after older moments clear." }, { status: 507 });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO room_flashes
      (id, event_slug, attendee_id, image_data, content_type, width, height, byte_size, status, moderation_result, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'allowed', ?, ?)
  `).bind(id, slug, access.attendeeId, imageBytes, FLASH_OUTPUT_CONTENT_TYPE, dimensions.width, dimensions.height, imageBytes.length, now, policy.readOnlyAt).run();
  const flash: FlashRecord = { id, eventSlug: slug, attendeeId: access.attendeeId, displayName: access.displayName, ...dimensions, createdAt: now, expiresAt: policy.readOnlyAt, mine: true };
  await env.THE_ROOM.getByName(slug).publishFlash(flash, policy);
  return Response.json({ flash }, { status: 201, headers: flashHeaders() });
}
