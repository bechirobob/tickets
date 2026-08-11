import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
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
} from "../lib/flashes";

describe("Room Flashes", () => {
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
});
