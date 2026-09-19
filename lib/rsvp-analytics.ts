export const rsvpSourceLabels: Record<string, string> = {
  untracked: 'Untracked', becore: 'BeCore Tickets', instagram: 'Instagram', 'kofi-bills': 'Kofi Bills',
};

export async function resolveRsvpSource(db: D1Database, eventSlug: string, source: unknown, ref: unknown) {
  if (typeof ref === 'string' && /^[A-Z0-9_-]{1,32}$/iu.test(ref)) {
    const promoter = await db.prepare("SELECT code FROM event_promoter_codes WHERE event_slug = ? AND code = ? AND status = 'active'")
      .bind(eventSlug, ref.toUpperCase()).first<{ code: string }>();
    if (promoter) return `promoter:${promoter.code}`;
  }
  return typeof source === 'string' && Object.hasOwn(rsvpSourceLabels, source) ? source : 'untracked';
}

export type RsvpAnalytics = {
  totals: { requests: number; guests: number; confirmedGuests: number; checkedIn: number; awaitingArrival: number; turnoutPercent: number | null };
  statuses: Array<{ status: string; requests: number; guests: number }>;
  sources: Array<{ eventSlug?: string; eventTitle?: string; source: string; label: string; requests: number; guests: number; confirmedGuests: number; checkedIn: number }>;
  promoterLinks: Array<{ eventSlug: string; code: string; label: string }>;
};
export const emptyRsvpAnalytics = (): RsvpAnalytics => ({
  totals: { requests: 0, guests: 0, confirmedGuests: 0, checkedIn: 0, awaitingArrival: 0, turnoutPercent: null },
  statuses: [], sources: [], promoterLinks: [],
});

export async function readRsvpAnalytics(db: D1Database, slugs: string[], start: string): Promise<RsvpAnalytics> {
  if (!slugs.length) return emptyRsvpAnalytics();
  const marks = slugs.map(() => '?').join(',');
  // One row per request. A guest-list check-in may later also have QR passes:
  // take the larger recorded count, never add the two representations together.
  const cohort = `WITH cohort AS (
    SELECT r.event_slug AS eventSlug, COALESCE(e.title,r.event_slug) AS eventTitle, r.status, r.party_size, r.acquisition_source,
      CASE WHEN r.status = 'confirmed' THEN MIN(r.party_size, MAX(
        COALESCE((SELECT COUNT(*) FROM tickets t WHERE t.order_id = r.order_id AND t.event_slug = r.event_slug AND t.status = 'checked_in'), 0),
        COALESCE((SELECT g.admission_count FROM guest_entries g WHERE g.id = 'rsvp:' || r.id AND g.event_slug = r.event_slug AND g.status = 'checked_in'), 0)
      )) ELSE 0 END AS arrivals
    FROM event_registrations r LEFT JOIN curated_event_records e ON e.slug=r.event_slug WHERE r.event_slug IN (${marks}) AND r.kind = 'rsvp' AND r.created_at >= ?
  )`;
  const [statuses, sources, promoters] = await Promise.all([
    db.prepare(`${cohort} SELECT status, COUNT(*) AS requests, SUM(party_size) AS guests, SUM(arrivals) AS checkedIn FROM cohort GROUP BY status`)
      .bind(...slugs, start).all<{ status: string; requests: number; guests: number; checkedIn: number }>(),
    db.prepare(`${cohort} SELECT eventSlug, MAX(eventTitle) AS eventTitle, acquisition_source AS source, COUNT(*) AS requests, SUM(party_size) AS guests,
      SUM(CASE WHEN status = 'confirmed' THEN party_size ELSE 0 END) AS confirmedGuests, SUM(arrivals) AS checkedIn
      FROM cohort GROUP BY eventSlug, acquisition_source ORDER BY requests DESC, eventSlug, acquisition_source`)
      .bind(...slugs, start).all<{ eventSlug: string; eventTitle: string; source: string; requests: number; guests: number; confirmedGuests: number; checkedIn: number }>(),
    db.prepare(`SELECT event_slug AS eventSlug, code, label FROM event_promoter_codes WHERE event_slug IN (${marks}) AND status = 'active' ORDER BY label, code`)
      .bind(...slugs).all<{ eventSlug: string; code: string; label: string }>(),
  ]);
  const totals = statuses.results.reduce((sum, row) => ({
    ...sum, requests: sum.requests + row.requests, guests: sum.guests + row.guests,
    confirmedGuests: sum.confirmedGuests + (row.status === 'confirmed' ? row.guests : 0), checkedIn: sum.checkedIn + row.checkedIn,
  }), emptyRsvpAnalytics().totals);
  totals.awaitingArrival = Math.max(0, totals.confirmedGuests - totals.checkedIn);
  totals.turnoutPercent = totals.confirmedGuests ? Math.round(totals.checkedIn / totals.confirmedGuests * 1000) / 10 : null;
  return { totals, statuses: statuses.results.map(({ status, requests, guests }) => ({ status, requests, guests })),
    sources: sources.results.map(row => ({ ...row, label: rsvpSourceLabels[row.source] ?? (row.source.startsWith('promoter:') ? `Promoter · ${row.source.slice(9)}` : 'Untracked') })),
    promoterLinks: promoters.results };
}
