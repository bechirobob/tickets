export async function readAnalyticsBaseline(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT started_at AS startedAt FROM analytics_baseline WHERE id=1').first<{startedAt:string}>();
  return row?.startedAt ?? null;
}

export function analyticsStart(start: string, baseline: string | null) {
  return baseline && baseline > start ? baseline : start;
}
