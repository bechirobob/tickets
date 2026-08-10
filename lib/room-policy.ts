export type RoomPolicy = {
  eventSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  readOnlyAt: string;
  readOnly: boolean;
};

const STATIC_EVENTS: Record<string, { title: string; startsAt: string; endsAt: string }> = {
  "after-dark-osu": { title: "After Dark: Osu", startsAt: "2026-08-14T22:00:00.000Z", endsAt: "2026-08-15T04:00:00.000Z" },
  "noir-room-labone": { title: "The Noir Room", startsAt: "2026-08-15T21:30:00.000Z", endsAt: "2026-08-16T03:00:00.000Z" },
  "sun-chasers-labadi": { title: "Sun Chasers", startsAt: "2026-08-16T15:00:00.000Z", endsAt: "2026-08-16T23:00:00.000Z" },
  "longitude-spintex": { title: "Longitude 05", startsAt: "2026-08-21T23:00:00.000Z", endsAt: "2026-08-22T05:00:00.000Z" },
};

export async function resolveRoomPolicy(db: D1Database, eventSlug: string): Promise<RoomPolicy | null> {
  const record = await db.prepare(`
    SELECT title, starts_at AS startsAt, ends_at AS endsAt
    FROM curated_event_records
    WHERE slug = ? AND status IN ('published', 'scheduled')
    LIMIT 1
  `).bind(eventSlug).first<{ title: string; startsAt: string; endsAt: string }>();
  const event = record ?? STATIC_EVENTS[eventSlug];
  if (!event) return null;
  const readOnlyAt = new Date(new Date(event.endsAt).getTime() + 72 * 60 * 60 * 1000).toISOString();
  return {
    eventSlug,
    eventTitle: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    readOnlyAt,
    readOnly: Date.now() >= new Date(readOnlyAt).getTime(),
  };
}
