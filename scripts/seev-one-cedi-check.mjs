// Owner-authorized, single-admission live payment check. No provider secrets needed.
// 'close' unpublishes only this fixture and preserves payment/accounting evidence.
import { pathToFileURL } from 'node:url';

export const slug = 'becore-payment-check-20260915';
const marker = 'operator:seev-one-cedi-20260915';
export function preparation(now = new Date().toISOString()) {
  const closes = new Date(Date.parse(now) + 2 * 60 * 60 * 1000).toISOString();
  const starts = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
  const ends = new Date(Date.parse(starts) + 60 * 60 * 1000).toISOString();
  return [
    {sql:`INSERT INTO party_submissions (id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,event_slug,created_at,updated_at)
      VALUES (?,'BeCore Tickets','BeCore Tickets','tickets@becoreops.com','','BeCore payment check','Owner-authorized live payment verification. No event admission.','Online','Online',?,?,'Day party','Payment verification only',1,100,'Owner payment check','published',?,?,?)`, params:[marker,starts,ends,slug,now,now]},
    {sql:`INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,sales_close_at,age_restriction,lineup,event_state,is_test_event,schedule_status,is_verified,image_url,curation_note,tagline,status,published_at,created_at,updated_at)
      VALUES (?,?,?,'BeCore payment check','Online','Online',?,?,'Day party',100,1,?,'Owner payment check','Payment verification only','on_sale',0,'confirmed',1,'/brand/becore-ticket.webp','A real GH₵1 payment to check checkout, your ticket and receipt. This does not grant admission to an event.','One cedi. One final check.','published',?,?,?)`,params:[marker,marker,slug,starts,ends,closes,now,now,now]},
    {sql:`INSERT INTO event_ticket_tiers (id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sales_close_at,created_at,updated_at)
      VALUES (?,?,'general','Payment check','One live test payment. No event admission.',100,1,1,1,'available',?,?,?)`,params:[marker,slug,closes,now,now]},
    {sql:`INSERT INTO event_registration_settings (event_slug,mode,capacity,max_party_size,approval_required,room_access,accepting,closes_at,notify_host,updated_at) VALUES (?,'paid',1,1,0,1,1,?,0,?)`,params:[slug,closes,now]},
    {sql:`INSERT INTO booking_fee_rules (id,percentage_basis_points,scope,scope_id,effective_at,created_at,created_by) VALUES (?,0,'event',?,?,?,'owner-authorized-live-check')`,params:[marker,slug,now,now]},
    {sql:`INSERT INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES (?,'owner','payment.live-check.prepare','event',?,'success','Owner requested one GHS 1.00 live purchase. One admission, zero booking fee, two-hour sales window. is_test_event=0 selects real production payments. Existing events unchanged.',?)`,params:[marker,slug,now]},
  ];
}

export function closure(now = new Date().toISOString()) {
  return [
    {sql:`UPDATE curated_event_records SET status='unpublished',scheduled_publish_at=NULL,sales_close_at=?,updated_at=? WHERE id=? AND slug=?`,params:[now,now,marker,slug]},
    {sql:`UPDATE party_submissions SET status='archived',updated_at=? WHERE id=? AND event_slug=?`,params:[now,marker,slug]},
    {sql:`UPDATE event_ticket_tiers SET status='hidden',sales_close_at=?,updated_at=? WHERE id=? AND event_slug=?`,params:[now,now,marker,slug]},
    {sql:`UPDATE event_registration_settings SET accepting=0,closes_at=?,updated_at=? WHERE event_slug=?`,params:[now,now,slug]},
    {sql:`INSERT OR IGNORE INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES (?,'owner','payment.live-check.close','event',?,'success','Temporary payment check unpublished. Production events unchanged. Payment, ticket and refund evidence retained; no refund status fabricated.',?)`,params:[`${marker}:closed`,slug,now]},
  ];
}

async function main() {
  const mode = process.env.CHECK_MODE || 'status';
  if (!['prepare','status','close','reopen','stop-sales'].includes(mode)) throw new Error('Unsupported check operation.');
  const account = 'af75a230de2eea882606db8d9acce473';
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('Cloudflare API token is required.');
  const headers = {authorization:`Bearer ${token}`,'content-type':'application/json'};
  const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
  const response = await fetch(`${root}?name=becore-tickets-db`, {headers,signal:AbortSignal.timeout(30000)});
  const listing = await response.json();
  const database = listing.result?.find(row=>row.name==='becore-tickets-db');
  if (!response.ok || !listing.success || !database?.uuid) throw new Error('Production database lookup failed.');
  async function query(body) {
    const result = await fetch(`${root}/${database.uuid}/query`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const data = await result.json();
    if (!result.ok || !data.success || !data.result?.length || data.result.some(row=>!row.success)) throw new Error('Scoped live-check database operation failed.');
    return data.result;
  }
  async function protectedEvents() {
    return JSON.stringify(await query({sql:`SELECT e.*, (SELECT json_group_array(json_object('id',t.id,'price',t.price_minor,'capacity',t.capacity_admissions,'status',t.status)) FROM event_ticket_tiers t WHERE t.event_slug=e.slug) AS tiers, (SELECT json_object('mode',s.mode,'accepting',s.accepting,'closes',s.closes_at) FROM event_registration_settings s WHERE s.event_slug=e.slug) AS registration FROM curated_event_records e WHERE e.slug IN ('the-weekend-braai','sun-chasers-labadi') ORDER BY e.slug`}).then(rows=>rows[0].results));
  }
  const before = await protectedEvents();
  if (mode === 'prepare') {
    const existing = (await query({sql:'SELECT id FROM operational_audit_events WHERE id=?',params:[marker]}))[0].results;
    if (!existing.length) await query({batch:preparation()});
  } else if (mode === 'reopen') {
    const reopenMarker = marker + ':checkout-form-reopen';
    const already = (await query({sql:'SELECT id FROM operational_audit_events WHERE id=?',params:[reopenMarker]}))[0].results;
    if (!already.length) {
      const eligible = (await query({sql:`SELECT e.id FROM curated_event_records e JOIN event_ticket_tiers t ON t.id=e.id WHERE e.id=? AND e.slug=? AND e.status='published' AND t.capacity_admissions=1 AND t.price_minor=100 AND t.max_units_per_order=1 AND (SELECT COUNT(*) FROM orders WHERE event_slug=e.slug)=1 AND EXISTS(SELECT 1 FROM orders WHERE id='606c91fc-c279-4583-aed9-603eea4a2c7c' AND event_slug=e.slug AND status='payment_pending' AND total_amount_minor=100 AND payment_provider='seevplus') AND NOT EXISTS(SELECT 1 FROM tickets WHERE event_slug=e.slug)`,params:[marker,slug]}))[0].results;
      if (eligible.length!==1) throw new Error('Checkout reopen conditions changed; inspect before changing inventory.');
      const now = new Date().toISOString();
      const closes = new Date(Date.now()+2*60*60*1000).toISOString();
      await query({batch:[
        {sql:"UPDATE curated_event_records SET capacity=2,sales_close_at=?,updated_at=? WHERE id=? AND slug=?",params:[closes,now,marker,slug]},
        {sql:"UPDATE party_submissions SET capacity=2,updated_at=? WHERE id=? AND event_slug=?",params:[now,marker,slug]},
        {sql:"UPDATE event_ticket_tiers SET capacity_admissions=2,sales_close_at=?,updated_at=? WHERE id=? AND event_slug=?",params:[closes,now,marker,slug]},
        {sql:"UPDATE event_registration_settings SET capacity=2,closes_at=?,updated_at=? WHERE event_slug=?",params:[closes,now,slug]},
        {sql:"INSERT INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES (?,'owner','payment.live-check.reopen','event',?,'success','Owner requested checkout-form test after transport repair. One additional test admission available; existing pending payment and reservation preserved. GHS1 total, zero booking fee, max one per order. Close fixture after verification.',?)",params:[reopenMarker,slug,now]}
      ]});
    }
  } else if (mode === 'stop-sales') {
    const paid=(await query({sql:"SELECT COUNT(*) AS count FROM orders WHERE event_slug=? AND status='paid' AND total_amount_minor=100",params:[slug]}))[0].results[0];
    if(paid.count!==1)throw new Error('Expected exactly one successful owner payment before stopping sales.');
    const now=new Date().toISOString();
    await query({batch:[
      {sql:"UPDATE curated_event_records SET sales_close_at=?,updated_at=? WHERE id=? AND slug=?",params:[now,now,marker,slug]},
      {sql:"UPDATE event_ticket_tiers SET sales_close_at=?,updated_at=? WHERE id=? AND event_slug=?",params:[now,now,marker,slug]},
      {sql:"UPDATE event_registration_settings SET accepting=0,closes_at=?,updated_at=? WHERE event_slug=?",params:[now,now,slug]},
      {sql:"INSERT OR IGNORE INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES (?,'owner','payment.live-check.stop-sales','event',?,'success','One paid test ticket verified. Stop further checkout while preserving the published ticket and Room pages for the owner to verify access. Unpublish after that check; retain payment evidence.',?)",params:[marker+':sales-stopped',slug,now]}
    ]});
  } else if (mode === 'close') {
    const existing = (await query({sql:'SELECT id FROM curated_event_records WHERE id=? AND slug=?',params:[marker,slug]}))[0].results;
    if (existing.length !== 1) throw new Error('Expected live-check fixture not found.');
    await query({batch:closure()});
  }
  if (before !== await protectedEvents()) throw new Error('Existing event data changed during the operation; inspect before continuing.');
  const summary = (await query({sql:`SELECT e.status,e.sales_close_at AS salesCloseAt,t.price_minor AS priceMinor,t.capacity_admissions AS capacity,t.max_units_per_order AS maxPerOrder,b.percentage_basis_points AS feeBasisPoints,(SELECT COUNT(*) FROM orders WHERE event_slug=e.slug) AS orders,(SELECT COUNT(*) FROM orders WHERE event_slug=e.slug AND status='paid') AS paidOrders,(SELECT COUNT(*) FROM tickets WHERE event_slug=e.slug) AS tickets FROM curated_event_records e JOIN event_ticket_tiers t ON t.event_slug=e.slug JOIN booking_fee_rules b ON b.scope_id=e.slug WHERE e.slug=?`,params:[slug]}))[0].results;
  const orders = (await query({sql:`SELECT o.status,o.created_at AS createdAt,o.reservation_expires_at AS expiresAt,o.failure_reason AS failureReason,(SELECT last_error FROM seev_checkout_sessions WHERE order_id=o.id) AS lastError,(SELECT checked_at FROM seev_checkout_sessions WHERE order_id=o.id) AS checkedAt,(o.provider_reference IS NOT NULL) AS hasProviderReference,(SELECT checkout_url IS NOT NULL FROM seev_checkout_sessions WHERE order_id=o.id) AS hasCheckoutUrl,o.total_amount_minor AS amountMinor,o.payment_provider AS provider,o.provider_status AS providerStatus,(SELECT claimed_at IS NOT NULL FROM order_access_grants WHERE order_id=o.id) AS ticketClaimed,(SELECT COUNT(*) FROM ticket_assignments a JOIN tickets t ON t.id=a.ticket_id WHERE t.order_id=o.id AND a.status='active') AS assignedTickets,o.refund_status AS refundStatus,o.refunded_amount_minor AS refundedMinor,(SELECT COUNT(*) FROM tickets WHERE order_id=o.id) AS tickets,(SELECT json_group_array(json_object('kind',d.kind,'status',d.status,'failureReason',d.failure_reason)) FROM delivery_events d WHERE d.order_id=o.id) AS delivery FROM orders o WHERE o.event_slug=? ORDER BY o.created_at`,params:[slug]}))[0].results;
  if (mode==='prepare' && (summary.length!==1 || summary[0].priceMinor!==100 || summary[0].feeBasisPoints!==0 || summary[0].capacity!==1 || summary[0].maxPerOrder!==1)) throw new Error('One-cedi test invariants failed.');
  if (mode==='close' && summary[0]?.status!=='unpublished') throw new Error('Test closure did not complete.');
  console.log(JSON.stringify({operation:mode,existingEvents:'unchanged',checkout:`https://tickets.becoreops.com/checkout/${slug}`,summary,orders}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
