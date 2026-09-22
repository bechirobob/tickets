import { readAnalyticsBaseline } from './analytics-baseline';
import { readRsvpAnalytics } from './rsvp-analytics';

export const hostScope = `(EXISTS (SELECT 1 FROM staff_event_assignments x WHERE x.account_id=a.id AND x.event_slug=e.slug)
  OR e.organizer_owner_id=a.id)`;
export async function canReadHostEvent(db: D1Database, accountId: string, slug: string, owner = false) {
  return Boolean(await db.prepare(`SELECT 1 FROM curated_event_records e JOIN staff_accounts a ON a.id=?
    WHERE e.slug=? AND e.removed_at IS NULL AND a.status='active' AND ((${owner ? "a.role='owner'" : "a.role='organizer'"}) AND ${owner ? '1=1' : hostScope})`)
    .bind(accountId,slug).first());
}
export async function readHostSummary(db: D1Database, slug: string) {
  const event = await db.prepare(`SELECT e.slug,e.title,e.venue,e.venue_map_url AS venueMapUrl,e.lineup,e.starts_at AS startsAt,e.ends_at AS endsAt,
    e.status,e.event_state AS eventState,e.schedule_status AS scheduleStatus,COALESCE(r.mode,'paid') AS mode,
    COALESCE(r.capacity,e.capacity) AS capacity,COALESCE(r.accepting,1) AS accepting,r.closes_at AS closesAt,
    COALESCE(r.approval_required,0) AS approvalRequired,r.updated_at AS setupAt,
    (SELECT COUNT(*) FROM staff_event_assignments x JOIN staff_accounts a ON a.id=x.account_id WHERE x.event_slug=e.slug AND a.role='gate' AND a.status='active') AS gateStaff,
    (SELECT COUNT(*) FROM event_ticket_tiers t WHERE t.event_slug=e.slug AND t.status IN ('available','sold_out') AND t.capacity_admissions>0 AND t.price_minor>0) AS activeTiers
    FROM curated_event_records e LEFT JOIN event_registration_settings r ON r.event_slug=e.slug WHERE e.slug=? AND e.removed_at IS NULL`)
    .bind(slug).first<{slug:string;title:string;venue:string;venueMapUrl:string;lineup:string;startsAt:string;endsAt:string;status:string;eventState:string;scheduleStatus:string;mode:string;capacity:number;accepting:number;closesAt:string|null;approvalRequired:number;setupAt:string|null;gateStaff:number;activeTiers:number}>();
  if (!event) return null;
  const baseline = await readAnalyticsBaseline(db);
  const start = baseline ?? '1970-01-01';
  const [rsvp,sales,interest,sources,pending] = await Promise.all([
    readRsvpAnalytics(db,[slug],start,baseline),
    db.prepare(`SELECT COUNT(*) AS orders,COALESCE(SUM(face_amount_minor),0) AS ticketSalesMinor,
      COALESCE(SUM((SELECT COUNT(*) FROM tickets t WHERE t.order_id=o.id AND t.status IN ('issued','checked_in'))),0) AS admissions,
      COALESCE(SUM((SELECT COUNT(*) FROM tickets t WHERE t.order_id=o.id AND t.status='checked_in')),0) AS checkedIn
      FROM orders o WHERE o.event_slug=? AND o.status='paid' AND o.payment_provider NOT IN ('rsvp','complimentary') AND COALESCE(o.paid_at,o.created_at)>=?`).bind(slug,start).first<{orders:number;ticketSalesMinor:number;admissions:number;checkedIn:number}>(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM event_registrations WHERE event_slug=? AND kind='interest' AND status='interested' AND created_at>=?) AS count,
      (SELECT COALESCE(SUM(admission_count),0) FROM guest_entries WHERE event_slug=? AND created_by<>'system:rsvp' AND id NOT LIKE 'rsvp:%' AND status IN ('expected','checked_in') AND created_at>=?) AS manualGuests,
      (SELECT COUNT(*) FROM tickets t JOIN orders o ON o.id=t.order_id WHERE t.event_slug=? AND o.payment_provider='complimentary' AND o.status='paid' AND t.status IN ('issued','checked_in') AND COALESCE(o.paid_at,o.created_at)>=?) AS complimentary,
      (SELECT COUNT(*) FROM tickets t JOIN orders o ON o.id=t.order_id WHERE t.event_slug=? AND o.payment_provider='complimentary' AND o.status='paid' AND t.status='checked_in' AND COALESCE(o.paid_at,o.created_at)>=?) AS compArrivals,
      (SELECT COALESCE(SUM(admission_count),0) FROM guest_entries WHERE event_slug=? AND created_by<>'system:rsvp' AND id NOT LIKE 'rsvp:%' AND status='checked_in' AND created_at>=?) AS manualArrivals`).bind(slug,start,slug,start,slug,start,slug,start,slug,start).first<{count:number;manualGuests:number;manualArrivals:number;complimentary:number;compArrivals:number}>(),
    db.prepare(`SELECT COALESCE(promoter_code,'') AS code,COUNT(*) AS orders FROM orders WHERE event_slug=? AND status='paid' AND payment_provider NOT IN ('rsvp','complimentary') AND COALESCE(paid_at,created_at)>=? GROUP BY promoter_code ORDER BY orders DESC,code LIMIT 5`).bind(slug,start).all<{code:string;orders:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM event_registrations WHERE event_slug=? AND kind='rsvp' AND status='requested'").bind(slug).first<{count:number}>(),
  ]);
  const paid = sales ?? {orders:0,ticketSalesMinor:0,admissions:0,checkedIn:0};
  const expected = rsvp.totals.confirmedGuests + paid.admissions + (interest?.complimentary ?? 0) + (interest?.manualGuests ?? 0);
  const checkedIn = rsvp.totals.checkedIn + paid.checkedIn + (interest?.compArrivals ?? 0) + (interest?.manualArrivals ?? 0);
  return {event,baseline,rsvp,sales:paid,interest:interest?.count ?? 0,paidSources:sources.results,
    pending:pending?.count ?? 0,
    manualGuests:interest?.manualGuests ?? 0,expected,checkedIn,turnoutPercent:expected ? Math.round(checkedIn/expected*1000)/10 : null};
}
export type HostSummary = NonNullable<Awaited<ReturnType<typeof readHostSummary>>>;

