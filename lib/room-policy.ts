export type RoomPolicy = {
  eventSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  readOnlyAt: string;
  readOnly: boolean;
  emergencyReadOnly: boolean;
  slowModeSeconds: number;
  archived: boolean;
};

export async function resolveRoomPolicy(db: D1Database, eventSlug: string): Promise<RoomPolicy | null> {
  const record = await db.prepare(`
    SELECT event.title, event.starts_at AS startsAt, event.ends_at AS endsAt,
           COALESCE(setting.emergency_read_only, false) AS emergencyReadOnly,
           COALESCE(setting.slow_mode_seconds, 0) AS slowModeSeconds,
           setting.archived_at AS archivedAt
    FROM curated_event_records event
    LEFT JOIN room_settings setting ON setting.event_slug = event.slug
    WHERE event.slug = ? AND event.status IN ('published', 'scheduled')
    LIMIT 1
  `).bind(eventSlug).first<{ title: string; startsAt: string; endsAt: string; emergencyReadOnly: number; slowModeSeconds: number; archivedAt: string | null }>();
  if (!record) return null;
  const readOnlyAt = new Date(new Date(record.endsAt).getTime() + 72 * 60 * 60 * 1000).toISOString();
  return {
    eventSlug,
    eventTitle: record.title,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    readOnlyAt,
    readOnly: Boolean(record.emergencyReadOnly) || Boolean(record.archivedAt) || Date.now() >= new Date(readOnlyAt).getTime(),
    emergencyReadOnly: Boolean(record.emergencyReadOnly),
    slowModeSeconds: [0, 5, 15, 30].includes(Number(record.slowModeSeconds)) ? Number(record.slowModeSeconds) : 0,
    archived: Boolean(record.archivedAt) || Date.now() >= new Date(readOnlyAt).getTime(),
  };
}
