export const FLASH_VIEW_DURATION_MS = 10_000;
export const FLASH_MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const FLASH_MAX_STORED_BYTES = 512 * 1024;
export const FLASH_MAX_ACTIVE_PER_ATTENDEE = 8;
export const FLASH_MAX_ACTIVE_PER_EVENT = 200;
export const FLASH_MAX_ACTIVE_STORAGE_BYTES = 150 * 1024 * 1024;
export const FLASH_QUARANTINE_REPORT_COUNT = 3;
export const FLASH_OUTPUT_CONTENT_TYPE = "image/webp";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FlashModerationOutcome = "allowed" | "blocked" | "unavailable";

export type FlashRecord = {
  id: string;
  eventSlug: string;
  attendeeId: string;
  displayName: string;
  width: number;
  height: number;
  createdAt: string;
  expiresAt: string;
  mine: boolean;
  openedAt?: string | null;
};

export function hasAcceptedFlashType(type: string): boolean {
  return acceptedTypes.has(type);
}

export function hasValidFlashSignature(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (type === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export function scaledFlashDimensions(width: number, height: number, maximum = 1600): { width: number; height: number } {
  if (width <= maximum && height <= maximum) return { width, height };
  const scale = maximum / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function parseFlashModerationResponse(response: string | undefined): FlashModerationOutcome {
  const first = response?.trim().toUpperCase().split(/\s+/u)[0]?.replace(/[^A-Z]/gu, "") ?? "";
  if (first === "ALLOW") return "allowed";
  if (first === "BLOCK") return "blocked";
  return "unavailable";
}

export async function moderateFlashImage(ai: Ai, bytes: Uint8Array): Promise<FlashModerationOutcome> {
  try {
    const result = await ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      prompt: [
        "Classify this event photo for a private adult nightlife feed.",
        "Reply with exactly ALLOW or BLOCK and no other words.",
        "ALLOW ordinary adult selfies, dancing, outfits, food, cocktails, bottles and venue scenes.",
        "BLOCK visible nudity or sexual activity, graphic injury, threatening weapons, hateful imagery, or clearly non-consensual intimate content.",
        "When genuinely uncertain, reply BLOCK. Do not identify anyone in the image.",
      ].join(" "),
      image: Array.from(bytes),
      max_tokens: 4,
      temperature: 0,
    });
    return parseFlashModerationResponse(result.response);
  } catch (error) {
    console.error(JSON.stringify({ message: "flash moderation unavailable", error: error instanceof Error ? error.message : String(error) }));
    return "unavailable";
  }
}

export async function purgeExpiredFlashes(db: D1Database, eventSlug?: string): Promise<number> {
  const now = new Date().toISOString();
  const query = eventSlug
    ? `SELECT id FROM room_flashes WHERE event_slug = ? AND status != 'deleted' AND expires_at <= ? LIMIT 200`
    : `SELECT id FROM room_flashes WHERE status != 'deleted' AND expires_at <= ? LIMIT 200`;
  const rows = eventSlug
    ? await db.prepare(query).bind(eventSlug, now).all<{ id: string }>()
    : await db.prepare(query).bind(now).all<{ id: string }>();
  // Receipts expire with the media, including owner/moderator removals.
  await db.prepare(`DELETE FROM room_flash_views WHERE flash_id IN
    (SELECT id FROM room_flashes WHERE (status = 'deleted' OR expires_at <= ?) ${eventSlug ? "AND event_slug = ?" : ""})`)
    .bind(...(eventSlug ? [now, eventSlug] : [now])).run();
  if (rows.results.length === 0) return 0;
  const statements = rows.results.map((row) => db.prepare(`
    UPDATE room_flashes
    SET image_data = NULL, status = 'deleted', moderation_result = 'expired', deleted_at = ?
    WHERE id = ? AND status != 'deleted'
  `).bind(now, row.id));
  await db.batch(statements);
  return rows.results.length;
}
