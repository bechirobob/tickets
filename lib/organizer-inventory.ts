import type { AdminSession } from './admin-session';
import { OrganizerError, requireOrganizerEvent, textInput, integerInput, organizerScope } from './organizer-access';

/** Save against the displayed revision, with stock checks in the write itself. */
export async function saveOrganizerTier(db: D1Database, session: AdminSession, body: Record<string, unknown>) {
  const event = await requireOrganizerEvent(db, session, body.eventSlug);
  const id = body.id ? textInput(body.id, 'ticket type', 120) : null;
  const name = textInput(body.name, 'ticket name', 80);
  const description = textInput(body.description, 'ticket description', 240);
  const price = integerInput(body.priceMinor, 'price in pesewas', 0, 100_000_000);
  const admissions = integerInput(body.admissionsPerUnit, 'admissions per package', 1, 20);
  const capacity = integerInput(body.capacity, 'admission capacity', admissions, 100_000);
  const limit = integerInput(body.maxUnitsPerOrder, 'packages per order', 1, 20);
  const status = textInput(body.status, 'availability', 20);
  if (!['available', 'sold_out', 'hidden'].includes(status)) throw new OrganizerError('Choose a valid availability.');
  if (body.roomBadge !== null && body.roomBadge !== 'VIP') throw new OrganizerError('Choose a valid Room grade.');
  const badge = body.roomBadge as 'VIP' | null;
  const revision = id ? textInput(body.updatedAt, 'saved revision', 50) : '';
  const now = new Date(Math.max(Date.now(), Date.parse(revision) + 1 || 0)).toISOString();
  const scope = organizerScope(session);
  // Recheck account scope, event lifecycle, held stock and other editors atomically.
  const editable = `EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug=event_ticket_tiers.event_slug AND e.removed_at IS NULL AND e.status IN ('draft','published','unpublished') AND e.event_state NOT IN ('cancelled','postponed') AND e.ends_at>? AND ${scope.sql})`;
  let write: D1PreparedStatement;
  if (id) {
    write = db.prepare(`UPDATE event_ticket_tiers SET name=?,description=?,price_minor=?,admissions_per_unit=?,capacity_admissions=?,max_units_per_order=?,status=?,room_badge=?,updated_at=?
      WHERE id=? AND event_slug=? AND updated_at=? AND ${editable}
      AND capacity_admissions IS NOT NULL
      AND ? >= COALESCE((SELECT SUM(r.admission_count) FROM inventory_reservations r WHERE r.ticket_tier_id=event_ticket_tiers.id AND (r.status='consumed' OR (r.status='held' AND r.expires_at>?))),0)
      AND (? <> 'hidden' OR EXISTS (SELECT 1 FROM event_ticket_tiers other WHERE other.event_slug=event_ticket_tiers.event_slug AND other.id<>event_ticket_tiers.id AND other.status<>'hidden'))
      AND ((admissions_per_unit=? AND room_badge IS ?) OR NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.ticket_tier_id=event_ticket_tiers.id))`)
      .bind(name,description,price,admissions,capacity,limit,status,badge,now,id,event.slug,revision,now,...scope.bindings,capacity,now,status,admissions,badge);
  } else {
    const code = textInput(body.code, 'ticket code', 40).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code)) throw new OrganizerError('Use lower-case words separated by hyphens for the code.');
    write = db.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,room_badge,sort_order,created_at,updated_at)
      SELECT ?,e.slug,?,?,?,?,?,?,?,?,?,COALESCE((SELECT MAX(sort_order)+1 FROM event_ticket_tiers WHERE event_slug=e.slug),0),?,?
      FROM curated_event_records e WHERE e.slug=? AND e.removed_at IS NULL AND e.status IN ('draft','published','unpublished') AND e.event_state NOT IN ('cancelled','postponed') AND e.ends_at>? AND ${scope.sql}
      AND (SELECT COUNT(*) FROM event_ticket_tiers WHERE event_slug=e.slug)<12
      AND NOT EXISTS (SELECT 1 FROM event_ticket_tiers WHERE event_slug=e.slug AND code=?)
      AND (?<>'hidden' OR EXISTS (SELECT 1 FROM event_ticket_tiers WHERE event_slug=e.slug AND status<>'hidden'))`)
      .bind(crypto.randomUUID(),code,name,description,price,admissions,capacity,limit,status,badge,now,now,event.slug,now,...scope.bindings,code,status);
  }
  const results = await db.batch([
    write,
    db.prepare(`UPDATE curated_event_records SET capacity=(SELECT COALESCE(SUM(capacity_admissions),0) FROM event_ticket_tiers WHERE event_slug=?),price_from_minor=(SELECT MIN(price_minor) FROM event_ticket_tiers WHERE event_slug=? AND status<>'hidden'),updated_at=? WHERE slug=? AND changes()>0`).bind(event.slug,event.slug,now,event.slug),
  ]);
  if (!results[0].meta.changes) {
    const latestEvent = await requireOrganizerEvent(db, session, event.slug);
    if (['cancelled','postponed'].includes(latestEvent.eventState) || latestEvent.endsAt <= now) throw new OrganizerError('This event no longer accepts ticket changes.',409);
    if (id) {
      const latest = await db.prepare(`SELECT updated_at AS updatedAt,admissions_per_unit AS admissions,room_badge AS badge,(SELECT COALESCE(SUM(admission_count),0) FROM inventory_reservations WHERE ticket_tier_id=t.id AND (status='consumed' OR (status='held' AND expires_at>?))) AS allocated FROM event_ticket_tiers t WHERE id=? AND event_slug=?`).bind(now,id,event.slug).first<{updatedAt:string;admissions:number;badge:string|null;allocated:number}>();
      if (!latest || latest.updatedAt !== revision) throw new OrganizerError('This grade was changed by another editor. Reload saved grade to review the latest values.',409);
      if (latest.allocated > capacity) throw new OrganizerError(`${latest.allocated} admissions are issued or held. Increase the total allocation to at least ${latest.allocated}.`,409);
      if (latest.admissions !== admissions || latest.badge !== badge) throw new OrganizerError('Existing passes keep their package size and Room access. Add a new grade for these changes.',409);
      throw new OrganizerError('Keep at least one ticket grade visible.',409);
    }
    throw new OrganizerError('This code is already in use, or the event already has 12 ticket grades. Refresh and review the list.',409);
  }
  return { saved: true, updatedAt: now };
}
