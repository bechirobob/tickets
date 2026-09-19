export type AnalyticsRange = '7' | '30' | '90' | 'all';

// Accra uses UTC. Daily visit counters and order timestamps must share the same boundary.
export function analyticsPeriod(value: string | null, now = new Date()) {
  const range: AnalyticsRange = value === '7' || value === '90' || value === 'all' ? value : '30';
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (range === 'all') return { range, start: '2000-01-01T00:00:00.000Z', previousStart: null, previousEnd: null };
  const start = new Date(today.getTime() - (Number(range) - 1) * 86400000);
  return { range, start: start.toISOString(), previousStart: new Date(start.getTime() - Number(range) * 86400000).toISOString(), previousEnd: start.toISOString() };
}

export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current - previous) / previous * 100) : current === 0 ? 0 : null;
}

export function hostEventEnded(event: { scheduleStatus: string; eventState: string; endsAt: string }, now: number) {
  return event.eventState === 'past' || (event.scheduleStatus !== 'coming_soon' && event.eventState !== 'postponed' && Date.parse(event.endsAt) < now);
}
