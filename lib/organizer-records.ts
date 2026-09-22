import type { AdminSession } from './admin-session';
import { OrganizerError, organizerScope, requireOrganizerEvent } from './organizer-access';

export async function listOrganizerEvents(db:D1Database,session:AdminSession){
  const scope=organizerScope(session);
  return (await db.prepare(`SELECT e.slug,e.title,e.starts_at AS startsAt,e.ends_at AS endsAt,e.status,e.event_state AS eventState,e.venue,e.area,e.capacity,
    CASE WHEN e.organizer_owner_id=? OR EXISTS (SELECT 1 FROM party_submissions s WHERE s.id=e.submission_id AND lower(trim(s.contact_email))=?) THEN 1 ELSE 0 END AS isLead,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_slug=e.slug AND r.status='requested') AS pendingRequests,
    (SELECT COUNT(*) FROM tickets t WHERE t.event_slug=e.slug AND t.status IN ('issued','checked_in')) AS admissions,
    (SELECT COUNT(*) FROM tickets t WHERE t.event_slug=e.slug AND t.status='checked_in') AS arrivals,
    (SELECT COALESCE(SUM(o.face_amount_minor),0) FROM orders o WHERE o.event_slug=e.slug AND o.status='paid') AS salesMinor
    FROM curated_event_records e WHERE e.removed_at IS NULL AND ${scope.sql} ORDER BY e.starts_at DESC LIMIT 500`)
    .bind(session.accountId,session.email,...scope.bindings).all()).results;
}
export async function readMoney(db:D1Database,session:AdminSession,slug:string){
  const scope=organizerScope(session);if(slug!=='all')await requireOrganizerEvent(db,session,slug);
  const events=`SELECT e.slug FROM curated_event_records e WHERE e.removed_at IS NULL AND ${scope.sql} AND (?='all' OR e.slug=?)`;
  const bindings=[...scope.bindings,slug,slug];
  const [totals,statements,transfers,payoutTotals]=await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(total_amount_minor),0) AS collectedMinor,COALESCE(SUM(booking_fee_minor),0) AS feesMinor,
      COALESCE(SUM(refunded_amount_minor),0) AS refundsMinor,COALESCE(SUM(face_amount_minor),0) AS faceMinor,
      COALESCE(SUM(CASE WHEN total_amount_minor>0 THEN ROUND(refunded_amount_minor*1.0*face_amount_minor/total_amount_minor) ELSE 0 END),0) AS ticketRefundsMinor
      FROM orders WHERE event_slug IN (${events}) AND status IN ('paid','refund_pending','refunded','disputed','requires_refund')`).bind(...bindings).first(),
    db.prepare(`SELECT s.id,s.event_slug AS eventSlug,e.title AS eventTitle,s.period_start AS periodStart,s.period_end AS periodEnd,
      s.gross_minor AS grossMinor,s.booking_fees_minor AS feesMinor,s.refunds_minor AS refundsMinor,s.net_ticket_sales_minor AS netMinor,s.currency,s.status
      FROM event_settlements s JOIN curated_event_records e ON e.slug=s.event_slug WHERE s.event_slug IN (${events}) ORDER BY s.period_end DESC LIMIT 250`).bind(...bindings).all(),
    db.prepare(`SELECT p.id,p.event_slug AS eventSlug,p.settlement_id AS settlementId,p.reference,p.amount_minor AS amountMinor,p.currency,p.status,p.paid_at AS paidAt,p.created_at AS createdAt,
      a.account_name AS accountName,a.account_number_masked AS accountNumberMasked FROM payout_transfers p LEFT JOIN organizer_payout_accounts a ON a.id=p.payout_account_id
      WHERE p.event_slug IN (${events}) ORDER BY p.created_at DESC LIMIT 250`).bind(...bindings).all(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='success' THEN amount_minor ELSE 0 END),0) AS paidMinor,COALESCE(SUM(CASE WHEN status IN ('pending_approval','queued','otp','pending') THEN amount_minor ELSE 0 END),0) AS pendingMinor FROM payout_transfers WHERE event_slug IN (${events})`).bind(...bindings).first(),
  ]);
  return {totals,payoutTotals,statements:statements.results,transfers:transfers.results};
}
const roster=`WITH roster AS (
 SELECT 'order' AS kind,o.id,COALESCE(o.customer_name,'Guest') AS name,o.customer_email AS email,o.reference,o.status,o.quantity AS admissions,
   o.total_amount_minor AS amountMinor,o.payment_provider AS source,o.created_at AS createdAt,
   (SELECT COUNT(*) FROM tickets t WHERE t.order_id=o.id AND t.status='checked_in') AS arrivals FROM orders o WHERE o.event_slug=? AND o.payment_provider<>'rsvp'
 UNION ALL SELECT 'registration',r.id,r.guest_name,r.normalized_email,COALESCE(o.reference,''),r.status,r.party_size,COALESCE(o.total_amount_minor,0),r.kind,r.created_at,
   (SELECT COUNT(*) FROM tickets t WHERE t.order_id=r.order_id AND t.status='checked_in') FROM event_registrations r LEFT JOIN orders o ON o.id=r.order_id WHERE r.event_slug=? AND r.status<>'unverified'
 UNION ALL SELECT 'door',g.id,g.guest_name,COALESCE(g.guest_email,''),'',g.status,g.admission_count,0,g.kind,g.created_at,
   CASE WHEN g.status='checked_in' THEN g.admission_count ELSE 0 END FROM guest_entries g WHERE g.event_slug=? AND g.created_by<>'system:rsvp'
)`;
export async function readGuests(db:D1Database,session:AdminSession,slug:string,params:URLSearchParams){
  await requireOrganizerEvent(db,session,slug);
  const q=(params.get('q')??'').trim().slice(0,120),status=(params.get('status')??'').slice(0,32),offset=Math.min(50000,Math.max(0,Number.parseInt(params.get('offset')??'0')||0));
  const filter=`WHERE (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(email),lower(?))>0 OR instr(lower(reference),lower(?))>0) AND (?='' OR status=?)`;
  const binds=[slug,slug,slug,q,q,q,q,status,status];
  const counts=await db.prepare(`${roster} SELECT COUNT(*) AS records,COALESCE(SUM(admissions),0) AS admissions,COALESCE(SUM(arrivals),0) AS arrivals FROM roster ${filter}`).bind(...binds).first();
  const show=params.get('show')==='1'||Boolean(q)||params.get('format')==='csv';
  const rows=show?(await db.prepare(`${roster} SELECT * FROM roster ${filter} ORDER BY createdAt DESC,id LIMIT ? OFFSET ?`).bind(...binds,params.get('format')==='csv'?10001:25,params.get('format')==='csv'?0:offset).all()).results:[];
  if(rows.length>10000)throw new OrganizerError('Narrow your search before exporting more than 10,000 records.');
  return {counts,rows,offset};
}
export async function guestDetails(db:D1Database,session:AdminSession,slug:string,kind:string,id:string){
  await requireOrganizerEvent(db,session,slug);
  const record=await db.prepare(`${roster} SELECT * FROM roster WHERE kind=? AND id=?`).bind(slug,slug,slug,kind,id).first();
  if(!record)throw new OrganizerError('Guest record not found.',404);
  const orderId=kind==='order'?id:kind==='registration'?(await db.prepare('SELECT order_id AS id FROM event_registrations WHERE id=? AND event_slug=?').bind(id,slug).first<{id:string}>())?.id:null;
  const tickets=orderId?(await db.prepare(`SELECT t.id,t.ticket_type AS ticketType,t.status,t.checked_in_at AS checkedInAt,
    CASE WHEN a.status='active' THEN p.display_name WHEN a.ticket_id IS NULL THEN o.customer_name END AS holderName,
    CASE WHEN a.status='active' THEN p.normalized_email WHEN a.ticket_id IS NULL THEN o.customer_email END AS holderEmail
    FROM tickets t JOIN orders o ON o.id=t.order_id LEFT JOIN ticket_assignments a ON a.ticket_id=t.id LEFT JOIN attendee_profiles p ON p.id=a.attendee_id
    WHERE t.order_id=? AND t.event_slug=? ORDER BY t.admission_number`).bind(orderId,slug).all()).results:[];
  const delivery=orderId?(await db.prepare('SELECT kind,status,updated_at AS updatedAt FROM delivery_events WHERE order_id=? ORDER BY created_at DESC LIMIT 10').bind(orderId).all()).results:[];
  const questions=orderId?(await db.prepare(`SELECT p.display_name AS name,q.prompt,a.answer FROM attendee_question_answers a
    JOIN event_questions q ON q.id=a.question_id AND q.event_slug=? JOIN attendee_profiles p ON p.id=a.attendee_id
    WHERE EXISTS (SELECT 1 FROM tickets t JOIN ticket_assignments ta ON ta.ticket_id=t.id AND ta.status='active' WHERE t.order_id=? AND ta.attendee_id=a.attendee_id)`).bind(slug,orderId).all()).results:[];
  const confirmation=orderId?await db.prepare('SELECT status,completed_at AS updatedAt FROM confirmation_deliveries WHERE order_id=?').bind(orderId).first():null;
  return {record,orderId,tickets,delivery,confirmation,questions};
}
export async function readAudience(db:D1Database,session:AdminSession,params:URLSearchParams){
  const scope=organizerScope(session),q=(params.get('q')??'').trim().slice(0,120),segment=params.get('segment')??'all',offset=Math.min(50000,Math.max(0,Number.parseInt(params.get('offset')??'0')||0));
  const sql=`WITH owned AS (SELECT e.slug FROM curated_event_records e WHERE e.removed_at IS NULL AND ${scope.sql}),
    visits AS (SELECT o.event_slug,lower(o.customer_email) AS email,COALESCE(o.customer_name,'Guest') AS name,
      CASE WHEN lower(o.ticket_type) LIKE '%vip%' THEN 1 ELSE 0 END AS vip,o.created_at AS at FROM orders o WHERE o.event_slug IN (SELECT slug FROM owned) AND o.status='paid'
      UNION ALL SELECT event_slug,normalized_email,guest_name,0,created_at FROM event_registrations WHERE event_slug IN (SELECT slug FROM owned) AND status IN ('confirmed','interested')),
    audience AS (SELECT v.email,MAX(v.name) AS name,COUNT(DISTINCT v.event_slug) AS events,MAX(v.vip) AS vip,MAX(v.at) AS lastSeen,
      CASE WHEN EXISTS (SELECT 1 FROM event_audience_contacts c WHERE c.event_slug IN (SELECT slug FROM owned) AND c.email=v.email AND c.consented_at IS NOT NULL AND c.consented_at>COALESCE(c.unsubscribed_at,'')
        AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email=c.email AND m.unsubscribed=1)) THEN 1 ELSE 0 END AS subscribed
      FROM visits v GROUP BY v.email)
    SELECT * FROM audience WHERE (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(email),lower(?))>0)
      AND (?='all' OR (?='repeat' AND events>1) OR (?='vip' AND vip=1) OR (?='subscribers' AND subscribed=1))`;
  if(!['all','repeat','vip','subscribers'].includes(segment))throw new OrganizerError('Choose an audience group.');
  const binds=[...scope.bindings,q,q,q,segment,segment,segment,segment];
  const totals=await db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(subscribed),0) AS subscribers FROM (${sql})`).bind(...binds).first();
  const show=params.get('show')==='1'||Boolean(q)||params.get('format')==='csv';
  const rows=show?(await db.prepare(`${sql} ORDER BY lastSeen DESC,email LIMIT ? OFFSET ?`).bind(...binds,params.get('format')==='csv'?10001:25,params.get('format')==='csv'?0:offset).all()).results:[];
  if(rows.length>10000)throw new OrganizerError('Narrow your search before exporting more than 10,000 records.');
  return {totals,rows,offset};
}
