import { recordAudit, type AdminSession } from './admin-session';

// Deliberately separate from removal: archive never changes orders, tickets,
// registrations, submissions, Room content, publication state or assignments.
export const eventArchiveEligibility = `removed_at IS NULL
  AND (is_test_event = 1 OR (schedule_status = 'confirmed' AND julianday(ends_at) < julianday('now')))
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.event_slug = curated_event_records.slug
    AND (o.status IN ('payment_pending','refund_pending','requires_refund','disputed')
      OR (o.status = 'paid' AND o.total_amount_minor > o.refunded_amount_minor
        AND (schedule_status <> 'confirmed' OR julianday(ends_at) >= julianday('now')))))
  AND NOT EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_slug = curated_event_records.slug
    AND r.status IN ('confirmed','requested','waitlisted','interested','unverified')
    AND (schedule_status <> 'confirmed' OR julianday(ends_at) >= julianday('now')))`;

export const protectedGuestList = { id: 'preview:event:sun-chasers-labadi', slug: 'sun-chasers-labadi' } as const;
export const cleanupEventRevision = `json_array(id, slug, updated_at, archived_at, status, schedule_status, ends_at, is_test_event,
  (SELECT COUNT(*) FROM orders o WHERE o.event_slug=curated_event_records.slug),
  (SELECT COUNT(*) FROM event_registrations r WHERE r.event_slug=curated_event_records.slug))`;
export async function eventCleanupPreview(db: D1Database) {
  return (await db.prepare(`SELECT id, slug, title, ${cleanupEventRevision} AS version,
    CASE WHEN id=? OR slug=? THEN 'Protected: On The Guest List is kept visible.'
      WHEN EXISTS (SELECT 1 FROM orders o WHERE o.event_slug=curated_event_records.slug AND o.status IN ('payment_pending','refund_pending','requires_refund','disputed')) THEN 'Blocked: pending payment, refund or dispute work.'
      WHEN is_test_event<>1 AND NOT (schedule_status='confirmed' AND julianday(ends_at)<julianday('now')) THEN 'Blocked: this real event has not ended.'
      WHEN NOT COALESCE((${eventArchiveEligibility}),0) THEN 'Blocked: this test has live bookings or registrations.'
      ELSE NULL END AS blockedReason,
    (SELECT COUNT(*) FROM orders o WHERE o.event_slug=curated_event_records.slug) AS orders,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_slug=curated_event_records.slug) AS registrations
    FROM curated_event_records WHERE archived_at IS NULL AND removed_at IS NULL ORDER BY (blockedReason IS NOT NULL), starts_at DESC, slug LIMIT 101`)
    .bind(protectedGuestList.id, protectedGuestList.slug).all<{id:string;slug:string;title:string;version:string;blockedReason:string|null;orders:number;registrations:number}>()).results;
}

export async function setEventArchived(db: D1Database, session: AdminSession, slug: string, archive: boolean, cleanupVersion?: string) {
  if (session.role !== 'owner' || session.mustChangePassword) throw new Error('Owner access is required.');
  if (!/^[a-z0-9-]{1,80}$/u.test(slug)) throw new Error('Choose an event.');
  const now = new Date().toISOString();
  // The eligibility check belongs in the write as well, so new bookings cannot
  // slip between a preview and archive. Repeating either action is harmless.
  const cleanupGuard = cleanupVersion === undefined ? '' : `AND id<>? AND slug<>? AND ${cleanupEventRevision}=?`;
  const bindings = cleanupVersion === undefined ? [archive ? now : null, now, slug]
    : [archive ? now : null, now, slug, protectedGuestList.id, protectedGuestList.slug, cleanupVersion];
  const result = await db.prepare(`UPDATE curated_event_records SET archived_at = ?, updated_at = ?
    WHERE slug = ? AND ${archive ? eventArchiveEligibility : 'removed_at IS NULL'} ${cleanupGuard}`)
    .bind(...bindings).run();
  if (!result.meta.changes) throw new Error(archive
    ? 'Only ended events or tests without live bookings can be archived. Resolve pending payments, refunds and disputes first.'
    : 'This event cannot be restored. Permanently removed events are not recoverable here.');
  await recordAudit(db, { session, action: archive ? 'event.archived' : 'event.restored', targetType: 'event', targetId: slug, outcome: 'success' });
  return { archived: archive };
}
