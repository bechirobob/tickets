import { env } from 'cloudflare:test';
import { afterEach,expect,it,vi } from 'vitest';
import { claimHostPass,hostPassStatus,provisionHostPass,sendHostPass } from '../lib/event-host-pass';
import { attendeeCookieHeader,hashToken,readAttendeeRoomAccess } from '../lib/attendee-auth';
import { readCurrentRoomHost } from '../lib/room-host-first-post';
import { POST as claimRoute } from '../app/api/customer/host-pass/claim/route';
import { GET as ownerRead,POST as ownerWrite } from '../app/api/admin/host-pass/route';
import { securityResponse } from '../worker/security-response';
afterEach(()=>vi.restoreAllMocks());
async function fixture() {
 const id=crypto.randomUUID(),slug=`host-pass-${id}`,account=`host-${id}`,email=`${account}@example.com`,now=new Date().toISOString(),endsAt=new Date(Date.now()+48*3600000).toISOString();
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
   SELECT ?,?,?,'Synthetic Night',venue,area,?,?,vibe,0,200,'on_sale',image_url,curation_note,'published',?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,endsAt,now,now,now),
  env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
   VALUES (?,?,'Private account name','organizer','test','test',600000,0,'active',?,?,'fixture',?)`).bind(account,email,now,now,now),
  env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(account,slug,account,now),
 ]);
 const runtime={...env,ROOM_HOST_FIRST_POST_ENABLED:'1',ROOM_HOST_FIRST_POST_EVENT_SLUG:slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:account,EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>'};
 return {runtime,id,slug,account,email,now,endsAt};
}
async function sent(f:Awaited<ReturnType<typeof fixture>>) {
 let token='';const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const body=JSON.parse(String(init?.body));token=new URL(/https:\/\/tickets\.becoreops\.com\/my-nights\/access\?kind=host#token=[A-Za-z0-9_-]+/u.exec(body.text)![0]).hash.slice(7);return Response.json({id:'synthetic-receipt'});});
 await provisionHostPass(f.runtime,f.email,'owner');await sendHostPass(f.runtime,f.email);
 return {token,fetchMock};
}
it('atomically creates one zero-cost private admission without queues, public tiers or staff changes',async()=>{
 const f=await fixture();const before=await env.DB.prepare('SELECT * FROM staff_accounts WHERE id=?').bind(f.account).first();
 await Promise.all([provisionHostPass(f.runtime,f.email,'owner'),provisionHostPass(f.runtime,f.email,'owner')]);
 const orders=await env.DB.prepare('SELECT * FROM orders WHERE event_slug=?').bind(f.slug).all();expect(orders.results).toHaveLength(1);
 expect(orders.results[0]).toMatchObject({payment_provider:'complimentary',payment_channel:'complimentary',ticket_type:'HOST',ticket_tier_id:null,quantity:1,total_amount_minor:0,face_amount_minor:0,booking_fee_minor:0});
 expect(await env.DB.prepare('SELECT SUM(total_amount_minor) AS revenue FROM orders WHERE event_slug=? AND status=\'paid\'').bind(f.slug).first()).toEqual({revenue:0});
 for(const table of ['confirmation_deliveries','event_registrations','event_ticket_tiers'])expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table==='confirmation_deliveries'?'order_id IN (SELECT id FROM orders WHERE event_slug=?)':'event_slug=?'}`).bind(f.slug).first()).toEqual({n:0});
 expect(await env.DB.prepare('SELECT * FROM staff_accounts WHERE id=?').bind(f.account).first()).toEqual(before);
 expect((await hostPassStatus(f.runtime,f.email)).invitation).toMatchObject({state:'provisioned',passValid:true,claimed:false});
 expect(await env.DB.prepare('SELECT token_hash FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first()).toEqual({token_hash:null});
});
it('sends once, stores only hash, claims exactly one pass, signs in normally, then rejects replay',async()=>{
 const f=await fixture(),{token,fetchMock}=await sent(f);
 expect(fetchMock).toHaveBeenCalledTimes(1);await expect(sendHostPass(f.runtime,f.email)).rejects.toThrow();
 const invite=await env.DB.prepare('SELECT * FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first();
 expect(invite?.token_hash).toBe(await hashToken(token));expect(JSON.stringify(invite)).not.toContain(token);
 const delivery=await env.DB.prepare("SELECT payload_json FROM delivery_events WHERE kind='event_host_pass' AND recipient=?").bind(f.email).first();expect(JSON.stringify(delivery)).not.toContain(token);
 const result=await claimHostPass(f.runtime,token);
 expect(result.redirectTo).toBe(`/room/${f.slug}`);
 const gate=await env.DB.prepare('SELECT g.token,t.qr_token_hash AS hash FROM ticket_gate_credentials g JOIN tickets t ON t.id=g.ticket_id WHERE t.event_slug=?').bind(f.slug).first<{token:string;hash:string}>();expect(gate!.hash).toBe(await hashToken(gate!.token));
 const access=await readAttendeeRoomAccess(env.DB,attendeeCookieHeader(result.sessionToken),f.slug);expect(access).not.toBeNull();
 expect(await readCurrentRoomHost(env.DB,access!.attendeeId,f.slug)).toMatchObject({accountId:f.account,displayName:'Host'});
 expect(await readAttendeeRoomAccess(env.DB,attendeeCookieHeader(result.sessionToken),'other-event')).toBeNull();
 await expect(claimHostPass(f.runtime,token)).rejects.toThrow();
});
it('reuses a currently held pass, including after transfer, and preserves the verified guest and other passes',async()=>{
 const f=await fixture();await provisionHostPass(f.runtime,f.email,'owner');
 const existing=await env.DB.prepare('SELECT ticket_id AS id FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first<{id:string}>();
 await env.DB.batch([
 env.DB.prepare('DELETE FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug),
 env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Existing person','active',?,?,?)").bind(f.id,f.email,f.now,f.now,f.now),
 env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'transfer','active',?)").bind(existing!.id,f.id,f.now),
 env.DB.prepare("UPDATE orders SET customer_email='other@example.com' WHERE event_slug=?").bind(f.slug),
 ]);
 expect((await provisionHostPass(f.runtime,f.email,'owner')).invitation?.reused).toBe(true);
 const {token}=await sent(f),result=await claimHostPass(f.runtime,token);
 expect((await readAttendeeRoomAccess(env.DB,attendeeCookieHeader(result.sessionToken),f.slug))?.attendeeId).toBe(f.id);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE event_slug=?').bind(f.slug).first()).toEqual({n:1});
});
it('has one winner for concurrent acceptance and does not verify an attacker-held unverified session',async()=>{
 const f=await fixture(),{token}=await sent(f);
 await env.DB.batch([
 env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,?,'Unverified','active',?,?)").bind(f.id,f.email,f.now,f.now),
 env.DB.prepare('INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(f.id,f.id,'unverified',f.endsAt,f.now,f.now),
 ]);
 const outcomes=await Promise.allSettled([claimHostPass(f.runtime,token),claimHostPass(f.runtime,token)]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await env.DB.prepare('SELECT revoked_at FROM attendee_sessions WHERE id=?').bind(f.id).first())?.revoked_at).not.toBeNull();
 expect((await env.DB.prepare('SELECT email_verified_at FROM attendee_profiles WHERE id=?').bind(f.id).first())?.email_verified_at).toBeNull();
});
for(const change of ['disabled','unassigned','email','revoked','transferred','expired','event','suspended','room'])it(`fails closed after ${change} revocation`,async()=>{
 const f=await fixture(),{token}=await sent(f);
 const sql:Record<string,string>={disabled:"UPDATE staff_accounts SET status='disabled' WHERE id=?",unassigned:'DELETE FROM staff_event_assignments WHERE account_id=?',email:"UPDATE staff_accounts SET normalized_email='different@example.com' WHERE id=?",expired:"UPDATE event_host_pass_invitations SET expires_at='2000-01-01' WHERE host_account_id=?",event:"UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?",room:"INSERT INTO room_settings(event_slug,emergency_read_only,updated_by,updated_at) VALUES(?,1,'fixture',?)"};
 if(change==='revoked'||change==='transferred'||change==='suspended'){
  await env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,?,'Guest',?,?,?)").bind(f.id,change==='transferred'?'other@example.com':f.email,change==='suspended'?'suspended':'active',f.now,f.now).run();
  await env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) SELECT ticket_id,?,'fixture',?,? FROM event_host_pass_invitations WHERE event_slug=?").bind(f.id,change==='revoked'?'revoked':'active',f.now,f.slug).run();
 }else await env.DB.prepare(sql[change]).bind(...(change==='room'?[f.slug,f.now]:[change==='event'?f.slug:f.account])).run();
 await expect(claimHostPass(f.runtime,token)).rejects.toThrow();
 expect(await env.DB.prepare('SELECT used_at FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first()).toEqual({used_at:null});
});
it('blocks wrong event, recipient, inactive flags and capacity without token creation or sending',async()=>{
 const f=await fixture();await expect(provisionHostPass(f.runtime,'wrong@example.com','owner')).rejects.toThrow();
 await env.DB.prepare('UPDATE curated_event_records SET capacity=0 WHERE slug=?').bind(f.slug).run();await expect(provisionHostPass(f.runtime,f.email,'owner')).rejects.toThrow();
 await env.DB.prepare('UPDATE curated_event_records SET capacity=200 WHERE slug=?').bind(f.slug).run();const {token,fetchMock}=await sent(f);
 await expect(claimHostPass({...f.runtime,ROOM_HOST_FIRST_POST_EVENT_SLUG:'different'},token)).rejects.toThrow();
 await expect(claimHostPass(f.runtime,token,'wrong@example.com')).rejects.toThrow();
 await expect(claimHostPass({...f.runtime,ROOM_HOST_FIRST_POST_ENABLED:'0'},token)).rejects.toThrow();expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('caps expiry at event end and never retries uncertain delivery',async()=>{
 const f=await fixture(),end=new Date(Date.now()+3600000).toISOString();await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE slug=?').bind(end,f.slug).run();
 await provisionHostPass(f.runtime,f.email,'owner');const fetchMock=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('uncertain'));
 expect((await sendHostPass(f.runtime,f.email)).invitation).toMatchObject({state:'uncertain',expiresAt:end});await expect(sendHostPass(f.runtime,f.email)).rejects.toThrow();expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('keeps owner and claim routes protected with no-referrer and no arbitrary return URL',async()=>{
 const request=new Request('https://tickets.becoreops.com/api/admin/host-pass');expect((await ownerRead(request)).status).toBe(403);
 expect((await ownerWrite(new Request(request.url,{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}))).status).toBe(403);
 const response=await claimRoute(new Request('https://tickets.becoreops.com/api/customer/host-pass/claim',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}));expect(response.status).toBe(403);
 for(const path of ['/my-nights/access','/api/customer/host-pass/claim'])expect(securityResponse(new Response(),undefined,path).headers.get('referrer-policy')).toBe('no-referrer');
});

import { ticketAccessRedirect } from '../lib/ticket-access-redirect';
import { retryFailedDeliveries } from '../lib/email-delivery';
it('restricts the host return to its exact server event and preserves normal recovery/transfer routes',()=>{
 const origin='https://tickets.becoreops.com';
 expect(ticketAccessRedirect('host','/room/one','one',origin)).toBe(origin+'/room/one');
 for(const path of ['https://evil.example/room/one','//evil.example/room/one','/room/two','/room/one?next=//evil.example','/room/one#token=bad','/my-nights','/room/one/../two','https://name@tickets.becoreops.com/room/one'])expect(()=>ticketAccessRedirect('host',path,'one',origin)).toThrow();
 for(const kind of ['recovery','transfer'] as const){expect(ticketAccessRedirect(kind,'/my-nights/one?view=passes',undefined,origin)).toBe(origin+'/my-nights/one?view=passes');expect(()=>ticketAccessRedirect(kind,'/room/one','one',origin)).toThrow();}
});
it('blocks ordinary retry workers from ever resending this private credential email',async()=>{
 const f=await fixture();await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,next_attempt_at,payload_json,created_at,updated_at) VALUES(?,'event_host_pass',?,'failed',1,'2000-01-01','{}',?,?)").bind(f.id,f.email,f.now,f.now).run();
 const fetchMock=vi.spyOn(globalThis,'fetch');await retryFailedDeliveries(f.runtime);expect(fetchMock).not.toHaveBeenCalled();
});
it('does not replace a revoked assignment during provisioning',async()=>{
 const f=await fixture();await provisionHostPass(f.runtime,f.email,'owner');
 await env.DB.batch([
 env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,?,'Guest','active',?,?)").bind(f.id,f.email,f.now,f.now),
 env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) SELECT ticket_id,?,'fixture','revoked',? FROM event_host_pass_invitations WHERE event_slug=?").bind(f.id,f.now,f.slug),
 env.DB.prepare('DELETE FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug),
 ]);
 await expect(provisionHostPass(f.runtime,f.email,'owner')).rejects.toThrow();
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_slug=?').bind(f.slug).first()).toEqual({n:1});
});

import { createStaffSession } from '../lib/admin-session';
it('owner control requires the existing owner session and its required MFA, not organizer credentials',async()=>{
 const f=await fixture(),token=await createStaffSession(env.DB,{id:f.account});
 const request=()=>new Request(`https://tickets.becoreops.com/api/admin/host-pass?accountId=${f.account}&email=${encodeURIComponent(f.email)}`,{headers:{cookie:`bct_staff=${token}`}});
 expect((await ownerRead(request())).status).toBe(403);
 await env.DB.prepare("UPDATE staff_accounts SET role='owner',mfa_required=1 WHERE id=?").bind(f.account).run();
 expect((await ownerRead(request())).status).toBe(403);
 await env.DB.prepare('UPDATE staff_sessions SET mfa_verified_at=? WHERE account_id=?').bind(f.now,f.account).run();
 expect((await ownerRead(request())).status).toBe(200);
 await env.DB.prepare('UPDATE staff_accounts SET must_change_password=1 WHERE id=?').bind(f.account).run();
 expect((await ownerRead(request())).status).toBe(403);
});
it('keeps a reused gate credential and other legitimate assignments unchanged',async()=>{
 const f=await fixture(),{token}=await sent(f);
 const oldGate='23456789ABCDEFGH';
 await env.DB.batch([
 env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Existing','active',?,?,?)").bind(f.id,f.email,f.now,f.now,f.now),
 env.DB.prepare("INSERT INTO ticket_gate_credentials(ticket_id,token,issued_at) SELECT ticket_id,?,? FROM event_host_pass_invitations WHERE event_slug=?").bind(oldGate,f.now,f.slug),
 env.DB.prepare('UPDATE tickets SET qr_token_hash=? WHERE event_slug=?').bind(await hashToken(oldGate),f.slug),
 env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at) VALUES(?,?,'other-legitimate-event',1,0,0,0,'GHS',?,'','complimentary','paid',?)").bind(f.id,f.id,f.email,f.now),
 env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,'other-legitimate-event','RSVP',?,'issued',?)").bind(f.id,f.id,f.id,f.now),
 env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'existing','active',?)").bind(f.id,f.id,f.now),
 ]);
 const before=await env.DB.prepare('SELECT * FROM ticket_assignments WHERE ticket_id=?').bind(f.id).first();
 const result=await claimHostPass(f.runtime,token);
 expect((await readAttendeeRoomAccess(env.DB,attendeeCookieHeader(result.sessionToken),f.slug))?.attendeeId).toBe(f.id);
 expect(await env.DB.prepare('SELECT * FROM ticket_assignments WHERE ticket_id=?').bind(f.id).first()).toEqual(before);
 expect((await env.DB.prepare('SELECT g.token FROM ticket_gate_credentials g JOIN tickets t ON t.id=g.ticket_id WHERE t.event_slug=?').bind(f.slug).first())?.token).toBe(oldGate);
});
it('limits longer events to a 24-hour private link, and cannot send before first-post activation',async()=>{
 const f=await fixture();await provisionHostPass(f.runtime,f.email,'owner');
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'synthetic-receipt'}));
 await expect(sendHostPass({...f.runtime,ROOM_HOST_FIRST_POST_ENABLED:'0'},f.email)).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();
 expect((await env.DB.prepare('SELECT token_hash FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first())?.token_hash).toBeNull();
 const before=Date.now(),status=await sendHostPass(f.runtime,f.email),expiry=Date.parse(status.invitation!.expiresAt!);
 expect(expiry-before).toBeGreaterThanOrEqual(86400000);expect(expiry-Date.now()).toBeLessThanOrEqual(86400000);
});
it('rejects ambiguous verified identities even if a damaged legacy schema has lost its partial uniqueness index',async()=>{
 const f=await fixture(),{token}=await sent(f),duplicate=`duplicate-${f.id}`;
 await env.DB.prepare('DROP INDEX attendee_profiles_verified_email_unique').run();
 try{
  for(const id of [f.id,duplicate])await env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Synthetic duplicate','active',?,?,?)").bind(id,f.email,f.now,f.now,f.now).run();
  await expect(claimHostPass(f.runtime,token)).rejects.toThrow();
  expect(await env.DB.prepare('SELECT used_at FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first()).toEqual({used_at:null});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_sessions WHERE attendee_id IN (?,?)').bind(f.id,duplicate).first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ticket_assignments WHERE attendee_id IN (?,?)').bind(f.id,duplicate).first()).toEqual({n:0});
 }finally{
  await env.DB.prepare('DELETE FROM attendee_profiles WHERE id=?').bind(duplicate).run();
  await env.DB.prepare('CREATE UNIQUE INDEX attendee_profiles_verified_email_unique ON attendee_profiles(normalized_email) WHERE email_verified_at IS NOT NULL').run();
 }
});
it('rolls back the entire acceptance when a later SQL statement fails, then permits a clean retry',async()=>{
 const f=await fixture(),{token,fetchMock}=await sent(f);
 const before=await env.DB.prepare('SELECT t.id,t.qr_token_hash FROM tickets t WHERE t.event_slug=?').bind(f.slug).first<{id:string;qr_token_hash:string}>();
 const trigger=`host_claim_failure_${f.id.replaceAll('-','_')}`;
 // Only this fictional recipient is affected. Fail at the final session insert,
 // after token consumption, profile creation, assignment and QR writes ran.
 await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON attendee_sessions
  WHEN NEW.attendee_id IN(SELECT id FROM attendee_profiles WHERE normalized_email='${f.email}')
  BEGIN SELECT RAISE(ABORT,'Synthetic claim failure'); END`).run();
 try{
  await expect(claimHostPass(f.runtime,token)).rejects.toThrow();
  expect(await env.DB.prepare('SELECT used_at,claimed_session_id FROM event_host_pass_invitations WHERE event_slug=?').bind(f.slug).first()).toEqual({used_at:null,claimed_session_id:null});
  expect(await env.DB.prepare('SELECT id,qr_token_hash FROM tickets WHERE id=?').bind(before!.id).first()).toEqual(before);
  for(const table of ['ticket_assignments','ticket_gate_credentials'])expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ticket_id=?`).bind(before!.id).first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_profiles WHERE normalized_email=?').bind(f.email).first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_sessions s JOIN attendee_profiles p ON p.id=s.attendee_id WHERE p.normalized_email=?').bind(f.email).first()).toEqual({n:0});
 }finally{await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();}
 const result=await claimHostPass(f.runtime,token);
 expect(await readAttendeeRoomAccess(env.DB,attendeeCookieHeader(result.sessionToken),f.slug)).not.toBeNull();
 expect(fetchMock).toHaveBeenCalledTimes(1);
});
