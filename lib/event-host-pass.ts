import { attendeeSessionExpiry, createSecureToken, hashToken } from './attendee-auth';
import { createGateToken, hashGateToken } from './gate-pass';
import { firstHostPublicName } from './room-host-first-post';
import { eventHostPassEmail } from './event-host-pass-email';
import { sendTransactional, transactionalConfigured, validTransactionalId } from './transactional-email';

const unavailable = () => new Error('This Host pass is unavailable. Review the event, account and existing pass before continuing.');
export function hostPassScope(env: Cloudflare.Env, active = false) {
  const eventSlug=env.ROOM_HOST_FIRST_POST_EVENT_SLUG, accountId=env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID;
  if (!eventSlug || !accountId || !/^[a-z0-9-]{1,120}$/u.test(eventSlug) || (active && env.ROOM_HOST_FIRST_POST_ENABLED!=='1')) throw unavailable();
  return {eventSlug,accountId};
}
// Evaluated inside each mutation, not only during the owner's preflight read.
const currentTarget = `FROM staff_accounts s JOIN staff_event_assignments host_assignment ON host_assignment.account_id=s.id
 JOIN curated_event_records e ON e.slug=host_assignment.event_slug

 WHERE s.id=? AND host_assignment.event_slug=? AND s.normalized_email=?
 AND s.role='organizer' AND s.status='active' AND s.must_change_password=0 AND (s.locked_until IS NULL OR s.locked_until<=?)
 AND e.removed_at IS NULL AND e.archived_at IS NULL AND e.status='published' AND e.schedule_status='confirmed'
 AND e.event_state IN ('on_sale','sold_out','rescheduled') AND e.ends_at>?
 AND (SELECT COUNT(*) FROM attendee_profiles p WHERE p.normalized_email=s.normalized_email AND p.email_verified_at IS NOT NULL)<=1
 AND NOT EXISTS(SELECT 1 FROM attendee_profiles p WHERE p.normalized_email=s.normalized_email AND p.status<>'active')
 AND NOT EXISTS(SELECT 1 FROM room_suspensions r JOIN attendee_profiles p ON p.id=r.attendee_id WHERE r.event_slug=e.slug AND p.normalized_email=s.normalized_email AND r.restored_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM room_settings r WHERE r.event_slug=e.slug AND (r.emergency_read_only=1 OR r.archived_at IS NOT NULL))`;
const eligiblePass = `FROM tickets t JOIN orders o ON o.id=t.order_id
 LEFT JOIN ticket_assignments a ON a.ticket_id=t.id LEFT JOIN attendee_profiles holder ON holder.id=a.attendee_id
 WHERE t.event_slug=? AND o.event_slug=t.event_slug AND o.status='paid' AND t.status IN ('issued','checked_in')
 AND ((a.status='active' AND holder.normalized_email=? AND holder.status='active') OR (a.ticket_id IS NULL AND LOWER(o.customer_email)=?))
 AND (o.payment_provider<>'rsvp' OR EXISTS(SELECT 1 FROM event_registrations r JOIN event_registration_settings rs ON rs.event_slug=r.event_slug
   WHERE r.order_id=o.id AND r.status='confirmed' AND rs.room_access=1))`;
type Invitation={id:string;eventSlug:string;accountId:string;email:string;ticketId:string;state:string;reused:number;expiresAt:string|null;usedAt:string|null};
const columns='id,event_slug AS eventSlug,host_account_id AS accountId,recipient_email AS email,ticket_id AS ticketId,state,reused,expires_at AS expiresAt,used_at AS usedAt';
const targetArgs=(scope:{accountId:string;eventSlug:string},email:string,now:string)=>[scope.accountId,scope.eventSlug,email,now,now];
export async function hostPassStatus(env:Cloudflare.Env,email:string) {
 const scope=hostPassScope(env),now=new Date().toISOString();
 const target=await env.DB.prepare(`SELECT e.title,e.ends_at AS endsAt,${firstHostPublicName} AS hostName ${currentTarget}`).bind(...targetArgs(scope,email,now)).first<{title:string;endsAt:string;hostName:string}>();
 if(!target)throw unavailable();
 const invitation=await env.DB.prepare(`SELECT ${columns} FROM event_host_pass_invitations WHERE event_slug=? AND host_account_id=? AND recipient_email=?`).bind(scope.eventSlug,scope.accountId,email).first<Invitation>();
 const pass=invitation ? await env.DB.prepare(`SELECT t.id ${eligiblePass} AND t.id=?`).bind(scope.eventSlug,email,email,invitation.ticketId).first() : null;
 return {eventSlug:scope.eventSlug,accountId:scope.accountId,email,title:target.title,hostName:target.hostName,endsAt:target.endsAt,invitation:invitation?{state:invitation.state,reused:!!invitation.reused,expiresAt:invitation.expiresAt,claimed:!!invitation.usedAt,passValid:!!pass}:null};
}

export async function provisionHostPass(env:Cloudflare.Env,email:string,actorId:string) {
 const scope=hostPassScope(env),now=new Date().toISOString();
 const id=crypto.randomUUID(),ticketId=crypto.randomUUID(),orderId=crypto.randomUUID(),nonce=crypto.randomUUID();
 const owns=`EXISTS(SELECT 1 FROM event_host_pass_invitations WHERE id=? AND provision_nonce=? AND ticket_id=?)`;
 // The first statement selects an existing pass and wins a unique event/account
 // claim in the same transaction as any new zero-cost admission. No queue writes.
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO event_host_pass_invitations(id,event_slug,host_account_id,recipient_email,ticket_id,provision_nonce,created_by,created_at,reused)
   SELECT ?,e.slug,s.id,s.normalized_email,COALESCE((SELECT t.id ${eligiblePass} ORDER BY t.issued_at,t.id LIMIT 1),?),?,?,?,0 ${currentTarget}
   AND (EXISTS(SELECT 1 ${eligiblePass}) OR (NOT EXISTS(SELECT 1 FROM tickets denied JOIN orders prior ON prior.id=denied.order_id JOIN ticket_assignments revoked ON revoked.ticket_id=denied.id JOIN attendee_profiles previous ON previous.id=revoked.attendee_id WHERE denied.event_slug=e.slug AND previous.normalized_email=s.normalized_email AND revoked.status<>'active') AND e.capacity>0 AND
    (SELECT COUNT(*) FROM tickets ct JOIN orders co ON co.id=ct.order_id WHERE ct.event_slug=e.slug AND ct.status IN ('issued','checked_in') AND co.status='paid')
    + (SELECT COALESCE(SUM(party_size),0) FROM event_registrations er WHERE er.event_slug=e.slug AND er.status='confirmed' AND NOT EXISTS(SELECT 1 FROM tickets rt WHERE rt.order_id=er.order_id AND rt.status IN ('issued','checked_in')))
    + (SELECT COALESCE(SUM(admission_count),0) FROM guest_entries ge WHERE ge.event_slug=e.slug AND ge.status IN ('expected','checked_in') AND ge.id NOT LIKE 'rsvp:%')
    + (SELECT COALESCE(SUM(admission_count),0) FROM inventory_reservations ir WHERE ir.event_slug=e.slug AND ir.status='held' AND ir.expires_at>?) < MIN(e.capacity,COALESCE((SELECT capacity FROM event_registration_settings rs WHERE rs.event_slug=e.slug AND rs.mode='rsvp'),e.capacity))))`)
   .bind(id,scope.eventSlug,email,email,ticketId,nonce,actorId,now,...targetArgs(scope,email,now),scope.eventSlug,email,email,now),
  env.DB.prepare(`UPDATE event_host_pass_invitations SET reused=CASE WHEN ticket_id=? THEN 0 ELSE 1 END WHERE id=? AND provision_nonce=?`).bind(ticketId,id,nonce),
  env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,unit_quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,payment_provider,status,created_at,paid_at)
   SELECT ?,?,event_slug,'HOST',1,1,0,0,0,'GHS',recipient_email,'','Host','complimentary','complimentary','paid',?,?
   FROM event_host_pass_invitations WHERE id=? AND provision_nonce=? AND ticket_id=?`).bind(orderId,`COMP-${orderId}`,now,now,id,nonce,ticketId),
  env.DB.prepare(`INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at)
   SELECT ?,id,event_slug,'HOST',1,?,'issued',? FROM orders WHERE id=? AND ${owns}`).bind(ticketId,`unissued-${ticketId}`,now,orderId,id,nonce,ticketId),
 ]);
 const result=await hostPassStatus(env,email);
 if(!result.invitation?.passValid)throw unavailable();
 return result;
}

export async function sendHostPass(env:Cloudflare.Env,email:string) {
 const scope=hostPassScope(env,true),status=await hostPassStatus(env,email);
 if(!status.invitation?.passValid || status.invitation.state!=='provisioned' || !transactionalConfigured(env,'resend') || env.EMAIL_FROM!=='BeCore Tickets <tickets@becoreops.com>')throw unavailable();
 const now=new Date().toISOString(),expiresAt=new Date(Math.min(Date.now()+86400000,Date.parse(status.endsAt))).toISOString();
 const token=createSecureToken(),tokenHash=await hashToken(token),deliveryId=`host-pass/${crypto.randomUUID()}`;
 const claimUrl=`https://tickets.becoreops.com/my-nights/access?kind=host#token=${token}`;
 const mail=eventHostPassEmail({eventTitle:status.title,hostName:status.hostName,claimUrl});
 const [claimed]=await env.DB.batch([
  env.DB.prepare(`UPDATE event_host_pass_invitations SET state='sending',token_hash=?,expires_at=?,delivery_id=?
   WHERE event_slug=? AND host_account_id=? AND recipient_email=? AND state='provisioned'
   AND EXISTS(SELECT 1 ${currentTarget}) AND ticket_id IN (SELECT t.id ${eligiblePass})`)
   .bind(tokenHash,expiresAt,deliveryId,scope.eventSlug,scope.accountId,email,...targetArgs(scope,email,now),scope.eventSlug,email,email),
  // Deliberately no plaintext token or rendered email in durable records/logs.
  env.DB.prepare(`INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at)
   SELECT ?,'event_host_pass',recipient_email,'sending',1,json_object('eventSlug',event_slug),?,?
   FROM event_host_pass_invitations WHERE delivery_id=? AND state='sending'`).bind(deliveryId,now,now,deliveryId),
 ]);
 if(claimed.meta.changes!==1)throw unavailable();
 try {
  const latest=await hostPassStatus(env,email);
  if(!latest.invitation?.passValid || env.ROOM_HOST_FIRST_POST_ENABLED!=='1')throw unavailable();
  const response=await sendTransactional(env,'resend',{...mail,recipient:email,kind:'event_host_pass',idempotencyKey:deliveryId,replyTo:'tickets@becoreops.com'});
  const receipt=await response.json().catch(()=>null) as {id?:string}|null;
  if(!response.ok || !validTransactionalId('resend',receipt?.id))throw unavailable();
  await env.DB.batch([
   env.DB.prepare("UPDATE delivery_events SET status='sent',provider_id=?,updated_at=? WHERE id=? AND status='sending'").bind(receipt.id,new Date().toISOString(),deliveryId),
   env.DB.prepare("UPDATE event_host_pass_invitations SET state='sent' WHERE delivery_id=? AND state='sending'").bind(deliveryId),
  ]);
 } catch {
  // Uncertain is terminal for automatic sending, including a crash after fetch.
  await env.DB.batch([
   env.DB.prepare("UPDATE delivery_events SET status='uncertain',failure_reason='Review the provider receipt; automatic resend is disabled.',updated_at=? WHERE id=? AND status='sending'").bind(new Date().toISOString(),deliveryId),
   env.DB.prepare("UPDATE event_host_pass_invitations SET state='uncertain' WHERE delivery_id=? AND state='sending'").bind(deliveryId),
  ]);
 }
 return hostPassStatus(env,email);
}

export async function claimHostPass(env:Cloudflare.Env,token:string,currentEmail?:string) {
 const scope=hostPassScope(env,true),now=new Date().toISOString(),tokenHash=await hashToken(token);
 const invitation=await env.DB.prepare(`SELECT ${columns} FROM event_host_pass_invitations WHERE token_hash=? AND event_slug=? AND host_account_id=?
  AND state IN ('sending','sent','uncertain') AND used_at IS NULL AND expires_at>?`).bind(tokenHash,scope.eventSlug,scope.accountId,now).first<Invitation>();
 if(!invitation || (currentEmail && currentEmail!==invitation.email))throw unavailable();
 const email=invitation.email,sessionId=crypto.randomUUID(),sessionToken=createSecureToken();
 const profileId=`member_${crypto.randomUUID()}`, gateToken=createGateToken();
 const canonical=`(SELECT id FROM attendee_profiles WHERE normalized_email=? AND status='active' AND email_verified_at IS NOT NULL ORDER BY created_at,id LIMIT 1)`;
 const owns=`EXISTS(SELECT 1 FROM event_host_pass_invitations WHERE id=? AND claimed_session_id=?)`;
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE event_host_pass_invitations SET used_at=?,claimed_session_id=? WHERE id=? AND token_hash=? AND used_at IS NULL AND expires_at>?
   AND EXISTS(SELECT 1 ${currentTarget}) AND ticket_id IN (SELECT t.id ${eligiblePass})`)
   .bind(now,sessionId,invitation.id,tokenHash,now,...targetArgs(scope,email,now),scope.eventSlug,email,email),
  env.DB.prepare(`INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at)
   SELECT ?,?,'Host','active',?,?,? WHERE ${owns} AND NOT EXISTS(SELECT 1 FROM attendee_profiles WHERE normalized_email=? AND email_verified_at IS NOT NULL)`)
   .bind(profileId,email,now,now,now,invitation.id,sessionId,email),
  // Proof must not verify a profile whose old unverified session could be held
  // by someone who merely typed this email. Preserve the existing verified user.
  env.DB.prepare(`UPDATE attendee_sessions SET revoked_at=? WHERE revoked_at IS NULL AND attendee_id IN(SELECT id FROM attendee_profiles WHERE normalized_email=? AND email_verified_at IS NULL) AND ${owns}`).bind(now,email,invitation.id,sessionId),
  env.DB.prepare(`INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at)
   SELECT ?,p.id,?,'active',? FROM attendee_profiles p WHERE p.id=${canonical} AND ${owns}
   ON CONFLICT(ticket_id) DO UPDATE SET attendee_id=excluded.attendee_id,assigned_by=excluded.assigned_by,status='active',assigned_at=excluded.assigned_at,revoked_at=NULL`)
   .bind(invitation.ticketId,`host-pass:${invitation.id}`,now,email,invitation.id,sessionId),
  env.DB.prepare(`INSERT OR IGNORE INTO ticket_gate_credentials(ticket_id,token,issued_at)
   SELECT ticket_id,?,? FROM event_host_pass_invitations WHERE id=? AND claimed_session_id=?`)
   .bind(gateToken,now,invitation.id,sessionId),
  env.DB.prepare(`UPDATE tickets SET qr_token_hash=? WHERE id=? AND ${owns}
   AND EXISTS(SELECT 1 FROM ticket_gate_credentials WHERE ticket_id=tickets.id AND token=?)`)
   .bind(await hashGateToken(gateToken),invitation.ticketId,invitation.id,sessionId,gateToken),
  env.DB.prepare(`INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at)
   SELECT ?,p.id,?,?,?,? FROM attendee_profiles p JOIN ticket_assignments a ON a.attendee_id=p.id AND a.ticket_id=? AND a.status='active'
   WHERE p.id=${canonical} AND ${owns}`)
   .bind(sessionId,await hashToken(sessionToken),attendeeSessionExpiry(),now,now,invitation.ticketId,email,invitation.id,sessionId),
 ]);
 if(results[0].meta.changes!==1 || results.at(-1)?.meta.changes!==1)throw unavailable();
 return {sessionToken,eventSlug:scope.eventSlug,redirectTo:`/room/${encodeURIComponent(scope.eventSlug)}`};
}
