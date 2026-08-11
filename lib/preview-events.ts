type PreviewSlot = {
  slug: string;
  weekday: number;
  hour: number;
  minute: number;
  durationMinutes: number;
};

const PREVIEW_SLOTS: PreviewSlot[] = [
  { slug: "after-dark-osu", weekday: 5, hour: 22, minute: 0, durationMinutes: 360 },
  { slug: "noir-room-labone", weekday: 6, hour: 21, minute: 30, durationMinutes: 330 },
  { slug: "sun-chasers-labadi", weekday: 0, hour: 15, minute: 0, durationMinutes: 480 },
  { slug: "longitude-spintex", weekday: 5, hour: 23, minute: 0, durationMinutes: 360 },
];

function nextStart(now: Date, slot: PreviewSlot): Date {
  const start = new Date(now);
  start.setUTCHours(slot.hour, slot.minute, 0, 0);
  const daysUntil = (slot.weekday - now.getUTCDay() + 7) % 7;
  start.setUTCDate(start.getUTCDate() + daysUntil);
  if (start.getTime() <= now.getTime()) start.setUTCDate(start.getUTCDate() + 7);
  return start;
}

export async function refreshExpiredPreviewEvents(db: D1Database, now = new Date()): Promise<number> {
  const expired = await db.prepare(`
    SELECT slug
    FROM curated_event_records
    WHERE is_test_event = 1 AND ends_at <= ?
  `).bind(now.toISOString()).all<{ slug: string }>();
  const expiredSlugs = new Set(expired.results.map((event) => event.slug));
  const updates = PREVIEW_SLOTS.filter((slot) => expiredSlugs.has(slot.slug)).map((slot) => {
    const startsAt = nextStart(now, slot);
    const endsAt = new Date(startsAt.getTime() + slot.durationMinutes * 60_000);
    return db.prepare(`
      UPDATE curated_event_records
      SET starts_at = ?, ends_at = ?, sales_close_at = ?, event_state = 'on_sale',
          rescheduled_from = NULL, status = 'published', updated_at = ?
      WHERE slug = ? AND is_test_event = 1
    `).bind(startsAt.toISOString(), endsAt.toISOString(), startsAt.toISOString(), now.toISOString(), slot.slug);
  });
  if (!updates.length) return 0;
  await db.batch(updates);
  return updates.length;
}
