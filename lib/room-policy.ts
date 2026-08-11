export type RoomPolicy = {
  eventSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  readOnlyAt: string;
  readOnly: boolean;
};

export async function resolveRoomPolicy(db: D1Database, eventSlug: string): Promise<RoomPolicy | null> {
  const record = await db.prepare(`
    SELECT title, starts_at AS startsAt, ends_at AS endsAt
    FROM curated_event_records
    WHERE slug = ? AND status IN ('published', 'scheduled')
    LIMIT 1
  `).bind(eventSlug).first<{ title: string; startsAt: string; endsAt: string }>();
  if (!record) return null;
  const readOnlyAt = new Date(new Date(record.endsAt).getTime() + 72 * 60 * 60 * 1000).toISOString();
  return {
    eventSlug,
    eventTitle: record.title,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    readOnlyAt,
    readOnly: Date.now() >= new Date(readOnlyAt).getTime(),
  };
}
