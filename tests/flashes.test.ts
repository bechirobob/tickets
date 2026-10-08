import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { DELETE as deleteFlash } from "../app/api/rooms/[slug]/flashes/[id]/route";
import { hashToken } from "../lib/attendee-auth";
import {
  FLASH_MAX_ACTIVE_PER_ATTENDEE,
  FLASH_MAX_ACTIVE_PER_EVENT,
  FLASH_MAX_ACTIVE_STORAGE_BYTES,
  FLASH_MAX_STORED_BYTES,
  hasAcceptedFlashType,
  hasValidFlashSignature,
  parseFlashModerationResponse,
  purgeExpiredFlashes,
  scaledFlashDimensions,
  storeFlash,
} from "../lib/flashes";

describe("Room Flashes", () => {
  it('keeps simultaneous uploads within the per-guest limit', async () => {
    const id = crypto.randomUUID(), now = new Date().toISOString(), future = new Date(Date.now() + 86_400_000).toISOString();
    const saved = await Promise.all(Array.from({ length: 12 }, () => storeFlash(env.DB, { id: crypto.randomUUID(), eventSlug: id, attendeeId: id, displayName: 'Guest', width: 160, height: 160, createdAt: now, expiresAt: future, mine: true }, new Uint8Array([1,2,3]))));
    expect(saved.filter(Boolean)).toHaveLength(8);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM room_flashes WHERE event_slug=?').bind(id).first()).toEqual({ count: 8 });
  });
  it("keeps temporary media inside the free D1 safety budget", () => {
    expect(FLASH_MAX_STORED_BYTES).toBe(512 * 1024);
    expect(FLASH_MAX_ACTIVE_PER_ATTENDEE).toBe(8);
    expect(FLASH_MAX_ACTIVE_PER_EVENT).toBe(200);
    expect(FLASH_MAX_ACTIVE_STORAGE_BYTES).toBe(150 * 1024 * 1024);
  });

  it("accepts only supported image signatures", () => {
    expect(hasAcceptedFlashType("image/jpeg")).toBe(true);
    expect(hasAcceptedFlashType("image/gif")).toBe(false);
    expect(hasValidFlashSignature(new Uint8Array([0xff, 0xd8, 0xff, 0x01]), "image/jpeg")).toBe(true);
    expect(hasValidFlashSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(hasValidFlashSignature(new TextEncoder().encode("RIFF0000WEBP"), "image/webp")).toBe(true);
    expect(hasValidFlashSignature(new TextEncoder().encode("not an image"), "image/jpeg")).toBe(false);
  });

  it("scales large images without stretching them", () => {
    expect(scaledFlashDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledFlashDimensions(800, 1200)).toEqual({ width: 800, height: 1200 });
  });

  it("fails automated moderation closed", () => {
    expect(parseFlashModerationResponse("ALLOW")).toBe("allowed");
    expect(parseFlashModerationResponse("BLOCK - unsafe")).toBe("blocked");
    expect(parseFlashModerationResponse("perhaps")).toBe("unavailable");
    expect(parseFlashModerationResponse(undefined)).toBe("unavailable");
  });

  it("physically erases expired image bytes and leaves live Flashes alone", async () => {
    const suffix = crypto.randomUUID();
    const expiredId = `expired-${suffix}`;
    const liveId = `live-${suffix}`;
    const now = Date.now();

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO room_flashes (id, event_slug, attendee_id, image_data, content_type, width, height, byte_size, status, moderation_result, created_at, expires_at) VALUES (?, ?, ?, ?, 'image/webp', 1, 1, 3, 'active', 'allowed', ?, ?)`)
        .bind(expiredId, `event-${suffix}`, `attendee-${suffix}`, new Uint8Array([1, 2, 3]), new Date(now - 60_000).toISOString(), new Date(now - 1_000).toISOString()),
      env.DB.prepare(`INSERT INTO room_flashes (id, event_slug, attendee_id, image_data, content_type, width, height, byte_size, status, moderation_result, created_at, expires_at) VALUES (?, ?, ?, ?, 'image/webp', 1, 1, 3, 'active', 'allowed', ?, ?)`)
        .bind(liveId, `event-${suffix}`, `attendee-${suffix}`, new Uint8Array([4, 5, 6]), new Date(now - 60_000).toISOString(), new Date(now + 60_000).toISOString()),
    ]);

    expect(await purgeExpiredFlashes(env.DB, `event-${suffix}`)).toBe(1);
    expect(await env.DB.prepare("SELECT image_data AS imageData, status, moderation_result AS moderationResult FROM room_flashes WHERE id = ?").bind(expiredId).first())
      .toEqual({ imageData: null, status: "deleted", moderationResult: "expired" });
    expect(await env.DB.prepare("SELECT image_data AS imageData FROM room_flashes WHERE id = ?").bind(liveId).first())
      .toEqual({ imageData: [4, 5, 6] });
  });

  it("expires at most 200 scoped Flashes with one update and clears all expired receipts", async () => {
    const slug = crypto.randomUUID(), now = new Date().toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();
    const ids = Array.from({ length: 201 }, (_, index) => `${slug}/${index}`);
    await env.DB.prepare(`INSERT INTO room_flashes
      (id,event_slug,attendee_id,image_data,width,height,byte_size,status,created_at,expires_at)
      SELECT value,?,? ,X'010203',1,1,3,CASE WHEN key=0 THEN 'hidden' ELSE 'active' END,?,?
      FROM json_each(?)`).bind(slug, slug, now, expired, JSON.stringify(ids)).run();
    await env.DB.prepare(`INSERT INTO room_flashes
      (id,event_slug,attendee_id,image_data,width,height,byte_size,created_at,expires_at)
      VALUES (?, ?, ?, X'040506',1,1,3,?,?)`).bind(`${slug}/other`, `${slug}-other`, slug, now, expired).run();
    await env.DB.prepare(`INSERT INTO room_flash_views(flash_id,attendee_id,view_id,opened_at,view_until)
      SELECT id,?,id,?,? FROM room_flashes WHERE event_slug IN (?,?)`)
      .bind(slug, expired, expired, slug, `${slug}-other`).run();
    const prepare = vi.fn((query: string) => env.DB.prepare(query));
    const db = { prepare } as unknown as D1Database;

    expect(await purgeExpiredFlashes(db, slug)).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(prepare.mock.calls.filter(([query]) => query.trim().startsWith("UPDATE"))).toHaveLength(1);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(image_data IS NULL) AS erased,
      SUM(status='deleted' AND moderation_result='expired') AS expired FROM room_flashes WHERE event_slug=?`)
      .bind(slug).first()).toEqual({ total: 201, erased: 200, expired: 200 });
    expect(await env.DB.prepare("SELECT flash_id FROM room_flash_views WHERE attendee_id=?").bind(slug).all())
      .toMatchObject({ results: [{ flash_id: `${slug}/other` }] });
    expect(await purgeExpiredFlashes(env.DB, slug)).toBe(1);
    expect(await env.DB.prepare("SELECT status,image_data AS bytes FROM room_flashes WHERE id=?").bind(`${slug}/0`).first())
      .toEqual({ status: "deleted", bytes: null });
    expect(await env.DB.prepare("SELECT status,image_data AS bytes FROM room_flashes WHERE id=?").bind(`${slug}/other`).first())
      .toEqual({ status: "active", bytes: [4, 5, 6] });
  });

  it("keeps the selected ID snapshot and preserves a concurrent owner removal", async () => {
    const slug = crypto.randomUUID(), expired = new Date(Date.now() - 60_000).toISOString();
    const insert = (id: string) => env.DB.prepare(`INSERT INTO room_flashes
      (id,event_slug,attendee_id,image_data,width,height,byte_size,created_at,expires_at)
      VALUES (?, ?, ?, X'010203',1,1,3,?,?)`).bind(id, slug, slug, expired, expired).run();
    await insert(`${slug}/selected`);
    const db = { prepare(query: string) {
      const statement = env.DB.prepare(query);
      if (!query.trim().startsWith("SELECT id")) return statement;
      return { bind(...values: unknown[]) {
        return { async all() {
          const rows = await statement.bind(...values).all<{ id: string }>();
          await env.DB.prepare("UPDATE room_flashes SET status='deleted',image_data=NULL,moderation_result='owner_removed',deleted_at=? WHERE id=?")
            .bind(expired, `${slug}/selected`).run();
          await insert(`${slug}/later`);
          return rows;
        } };
      } };
    } } as unknown as D1Database;

    expect(await purgeExpiredFlashes(db, slug)).toBe(1);
    expect(await env.DB.prepare("SELECT status,moderation_result AS reason,deleted_at AS deletedAt FROM room_flashes WHERE id=?")
      .bind(`${slug}/selected`).first()).toEqual({ status: "deleted", reason: "owner_removed", deletedAt: expired });
    expect(await env.DB.prepare("SELECT status,image_data AS bytes FROM room_flashes WHERE id=?").bind(`${slug}/later`).first())
      .toEqual({ status: "active", bytes: [1, 2, 3] });
  });

  it("clears removed-photo receipts when no Flashes need expiry, including the global pass", async () => {
    const slug = crypto.randomUUID(), now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    await env.DB.prepare(`INSERT INTO room_flashes
      (id,event_slug,attendee_id,width,height,byte_size,status,moderation_result,created_at,expires_at,deleted_at)
      SELECT value,value,?,1,1,0,'deleted','owner_removed',?,?,? FROM json_each(?)`)
      .bind(slug, now, future, now, JSON.stringify([slug, `${slug}-other`])).run();
    await env.DB.prepare(`INSERT INTO room_flash_views(flash_id,attendee_id,view_id,opened_at,view_until)
      SELECT id,?,id,?,? FROM room_flashes WHERE attendee_id=?`).bind(slug, now, future, slug).run();
    const prepare = vi.fn((query: string) => env.DB.prepare(query));

    expect(await purgeExpiredFlashes({ prepare } as unknown as D1Database, slug)).toBe(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare("SELECT flash_id FROM room_flash_views WHERE attendee_id=?").bind(slug).all())
      .toMatchObject({ results: [{ flash_id: `${slug}-other` }] });
    await purgeExpiredFlashes(env.DB);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM room_flash_views WHERE attendee_id=?").bind(slug).first())
      .toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT moderation_result AS reason,deleted_at AS deletedAt FROM room_flashes WHERE id=?").bind(slug).first())
      .toEqual({ reason: "owner_removed", deletedAt: now });
  });

  it("lets the owner permanently remove a live Flash", async () => {
    const suffix = crypto.randomUUID();
    const attendeeId = `flash-owner:${suffix}`;
    const sessionToken = `flash-session-${suffix}-secure-value`;
    const orderId = `flash-order:${suffix}`;
    const ticketId = `flash-ticket:${suffix}`;
    const flashId = `flash:${suffix}`;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, status, created_at, updated_at) VALUES (?, ?, 'Flash Owner', 'active', ?, ?)").bind(attendeeId, `${suffix}@example.com`, now, now),
      env.DB.prepare("INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`flash-session:${suffix}`, attendeeId, await hashToken(sessionToken), future, now, now),
      env.DB.prepare("INSERT INTO orders (id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, created_at, paid_at) VALUES (?, ?, 'after-dark-osu', 1, 12000, 0, 12000, 'GHS', ?, '233000000000', 'mobile_money:mtn', 'paid', ?, ?)").bind(orderId, `BCT-FLASH-${suffix}`, `${suffix}@example.com`, now, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at) VALUES (?, ?, 'after-dark-osu', 'general', ?, 'issued', ?)").bind(ticketId, orderId, `flash-qr:${suffix}`, now),
      env.DB.prepare("INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)").bind(ticketId, attendeeId, orderId, now),
      env.DB.prepare("INSERT INTO room_flashes (id, event_slug, attendee_id, image_data, content_type, width, height, byte_size, status, moderation_result, created_at, expires_at) VALUES (?, 'after-dark-osu', ?, ?, 'image/webp', 1, 1, 3, 'active', 'allowed', ?, ?)").bind(flashId, attendeeId, new Uint8Array([1, 2, 3]), now, future),
    ]);

    const response = await deleteFlash(new Request(`https://tickets.becoreops.com/api/rooms/after-dark-osu/flashes/${flashId}`, {
      method: "DELETE",
      headers: { origin: "https://tickets.becoreops.com", cookie: `bct_attendee=${sessionToken}` },
    }), { params: Promise.resolve({ slug: "after-dark-osu", id: flashId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(await env.DB.prepare("SELECT image_data AS imageData, status, moderation_result AS moderationResult, deleted_at AS deletedAt FROM room_flashes WHERE id = ?").bind(flashId).first())
      .toEqual({ imageData: null, status: "deleted", moderationResult: "owner_removed", deletedAt: expect.any(String) });
  });
});
