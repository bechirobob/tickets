import { recordAudit, type AdminSession } from './admin-session';
export async function removalImpact(db: D1Database, slug: string) {
  return db.prepare(`SELECT e.slug, e.title, e.removed_at AS removedAt, e.event_state AS eventState,
    (e.schedule_status = 'coming_soon' OR julianday(e.ends_at) >= julianday('now')) AS upcoming,
    (SELECT COUNT(*) FROM orders WHERE event_slug = e.slug AND payment_provider <> 'rsvp' AND total_amount_minor > refunded_amount_minor AND status IN ('paid','refund_pending','requires_refund','disputed')) AS paidBookings,
    (SELECT COUNT(*) FROM event_registrations WHERE event_slug = e.slug AND status IN ('confirmed','requested','waitlisted','interested','unverified')) AS registrations
    FROM curated_event_records e WHERE e.slug = ?`).bind(slug).first<{ slug: string; title: string; removedAt: string | null; eventState: string; upcoming: number; paidBookings: number; registrations: number }>();
}
/** Tombstone first; cleanup is repeatable and may safely resume after a failure. */
export async function removeEvent(env: Cloudflare.Env, session: AdminSession, slug: string, approved = false, reason = "Event removal") {
  const impact = await removalImpact(env.DB, slug);
  if (!impact) throw new Error('Event not found.');
  if (!approved && !impact.removedAt && impact.eventState !== "cancelled" && impact.upcoming && impact.paidBookings) throw new Error('This event has paid bookings. Request removal approval first.');
  const now = new Date().toISOString();
  const guard = approved || impact.removedAt || impact.eventState === 'cancelled' ? '' : `AND NOT ((schedule_status = 'coming_soon' OR julianday(ends_at) >= julianday('now')) AND EXISTS (SELECT 1 FROM orders WHERE event_slug = curated_event_records.slug AND payment_provider <> 'rsvp' AND total_amount_minor > refunded_amount_minor AND status IN ('paid','refund_pending','requires_refund','disputed')))`;
  const [marked] = await env.DB.batch([
    env.DB.prepare(`UPDATE curated_event_records SET removed_at = COALESCE(removed_at, ?), status = 'unpublished', scheduled_publish_at = NULL, updated_at = ? WHERE slug = ? ${guard}`).bind(now, now, slug),
    env.DB.prepare("INSERT OR IGNORE INTO event_removal_cleanup (event_slug, created_at) SELECT slug, ? FROM curated_event_records WHERE slug = ? AND removed_at IS NOT NULL").bind(now, slug),
  ]);
  if (!marked.meta.changes) throw new Error('New bookings arrived. Refresh and request removal approval.');
  await recordAudit(env.DB, { session, action: 'event.removed', targetType: 'event', targetId: slug, outcome: 'success', detail: reason.slice(0, 500) });
  await cleanupRemovedEvent(env, slug);
  return { removed: true };
}
export async function cleanupRemovedEvent(env: Cloudflare.Env, slug: string) {
  if (!await env.DB.prepare('SELECT 1 FROM curated_event_records WHERE slug = ? AND removed_at IS NOT NULL').bind(slug).first()) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE party_submissions SET status = 'archived', poster_data = NULL, poster_object_key = NULL, poster_content_type = NULL, updated_at = ? WHERE event_slug = ?").bind(now, slug),
    env.DB.prepare("UPDATE event_ticket_tiers SET status = 'hidden', updated_at = ? WHERE event_slug = ?").bind(now, slug),
    env.DB.prepare("UPDATE tickets SET status = 'voided' WHERE event_slug = ? AND status = 'issued'").bind(slug),
    env.DB.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE event_slug = ? AND status = 'held'").bind(now, slug),
    env.DB.prepare("UPDATE orders SET status = 'expired' WHERE event_slug = ? AND status = 'payment_pending'").bind(slug),
    env.DB.prepare("UPDATE event_registrations SET status = 'cancelled', version = version + 1, updated_at = ? WHERE event_slug = ? AND status NOT IN ('cancelled','declined')").bind(now, slug),
    env.DB.prepare("UPDATE room_flashes SET status = 'deleted', image_data = NULL, deleted_at = ? WHERE event_slug = ?").bind(now, slug),
    env.DB.prepare("UPDATE event_promoter_codes SET status = 'disabled' WHERE event_slug = ?").bind(slug),
    env.DB.prepare('DELETE FROM registration_access_grants WHERE registration_id IN (SELECT id FROM event_registrations WHERE event_slug = ?)').bind(slug),
    ...['room_settings','room_suspensions','event_updates','event_memories','attendee_notifications','guest_entries','gate_devices','event_readiness_checks','staff_event_assignments'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE event_slug = ?`).bind(slug)),
    env.DB.prepare("UPDATE event_waitlist_entries SET status = 'cancelled' WHERE event_slug = ?").bind(slug),
    env.DB.prepare("UPDATE room_reports SET status = 'actioned' WHERE event_slug = ? AND status = 'open'").bind(slug),
    env.DB.prepare("UPDATE room_flash_reports SET status = 'actioned' WHERE event_slug = ? AND status = 'open'").bind(slug),
  ]);
  await env.THE_ROOM.getByName(slug).removeEventContent();
  await env.DB.prepare('DELETE FROM event_removal_cleanup WHERE event_slug = ?').bind(slug).run();
}

export async function retryEventRemovals(env: Cloudflare.Env) {
  const pending = await env.DB.prepare('SELECT event_slug AS slug FROM event_removal_cleanup ORDER BY created_at LIMIT 20').all<{ slug: string }>();
  for (const event of pending.results) await cleanupRemovedEvent(env, event.slug);
}
