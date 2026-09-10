import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { POST as recover, GET as recoveryLanding } from '../app/api/customer/recovery/claim/route';
import { POST as accept, GET as transferLanding } from '../app/api/customer/transfers/claim/route';
import { POST as wallet } from '../app/api/customer/tickets/route';
import { createSecureToken, hashToken } from '../lib/attendee-auth';
import { hashGateToken } from '../lib/gate-pass';

const origin='https://tickets.becoreops.com';
const claim=(path:string,token:string)=>new Request(`${origin}/api/customer/${path}/claim`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});
async function fixture() {
  const id=crypto.randomUUID(),now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
  const eventSlug=`ownership-${id}`;
  const sender=`sender-${id}`,recipient=`member_${(await hashToken(`recipient-${id}@example.com`)).slice(0,32)}`;
  const senderEmail=`sender-${id}@example.com`,recipientEmail=`recipient-${id}@example.com`,token=createSecureToken(),session=createSecureToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) SELECT ?,?, ?,title,venue,area,starts_at,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',published_at,created_at,updated_at FROM curated_event_records WHERE slug='after-dark-osu'").bind(`event-${id}`,`submission-${id}`,eventSlug,future),
    env.DB.prepare("INSERT INTO attendee_profiles (id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES (?,?,'Sender',?,'active',?,?)").bind(sender,senderEmail,now,now,now),
    env.DB.prepare("INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)").bind(`session-${id}`,sender,await hashToken(session),future,now,now),
    env.DB.prepare("INSERT INTO orders (id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES (?,?,?,'general',1,10000,0,10000,'GHS',?,'233000000000','mobile_money:mtn','paid',?,?)").bind(`order-${id}`,`BCT-${id}`,eventSlug,senderEmail,now,now),
    env.DB.prepare("INSERT INTO tickets (id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',1,?,'issued',?)").bind(`ticket-${id}`,`order-${id}`,eventSlug,`initial-${id}`,now),
    env.DB.prepare("INSERT INTO ticket_assignments (ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'fixture','active',?)").bind(`ticket-${id}`,sender,now),
    env.DB.prepare("INSERT INTO ticket_transfers (id,ticket_id,sender_attendee_id,recipient_email,token_hash,status,expires_at,created_at) VALUES (?,?,?,?,?,'pending',?,?)").bind(`transfer-${id}`,`ticket-${id}`,sender,recipientEmail,await hashToken(token),future,now),
  ]);
  async function recovery(email:string) {
    const value=createSecureToken(),grant=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO attendee_recovery_grants (id,normalized_email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)').bind(grant,email,await hashToken(value),future,now).run();
    return {token:value,id:grant};
  }
  return {id,eventSlug,sender,recipient,senderEmail,recipientEmail,token,cookie:`bct_attendee=${session}`,recovery};
}

describe('ticket ownership across links, transfers and recovery',()=>{
  it('does not consume one-time links when an email scanner opens them',async()=>{
    const f=await fixture(),grant=await f.recovery(f.senderEmail);
    for(const [handler,kind,token] of [[recoveryLanding,'recovery',grant.token],[transferLanding,'transfers',f.token]] as const){
      const response=handler(new Request(`${origin}/api/customer/${kind}/claim?token=${token}`));
      expect(response.status).toBe(303);expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('location')).toContain('/my-nights/access?kind=');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(await env.DB.prepare('SELECT used_at FROM attendee_recovery_grants WHERE id=?').bind(grant.id).first()).toEqual({used_at:null});
    expect(await env.DB.prepare('SELECT status FROM ticket_transfers WHERE id=?').bind(`transfer-${f.id}`).first()).toEqual({status:'pending'});
  });
  it('keeps a transferred ticket with its recipient when the purchaser recovers their wallet',async()=>{
    const f=await fixture(),senderGrant=await f.recovery(f.senderEmail);
    expect((await accept(claim('transfers',f.token))).status).toBe(200);
    expect((await recover(claim('recovery',senderGrant.token))).status).toBe(400);
    expect(await env.DB.prepare('SELECT attendee_id FROM ticket_assignments WHERE ticket_id=?').bind(`ticket-${f.id}`).first()).toEqual({attendee_id:f.recipient});
    const recipientGrant=await f.recovery(f.recipientEmail);
    const response=await recover(claim('recovery',recipientGrant.token));expect(response.status).toBe(200);
    const result=await wallet(new Request(`${origin}/api/customer/tickets`,{method:'POST',headers:{origin,cookie:response.headers.get('set-cookie')!.split(';')[0]}}));
    const data=await result.json() as {orders:Array<{canViewPurchase:boolean;tickets:unknown[]}>};
    expect(data.orders).toHaveLength(1);expect(data.orders[0].canViewPurchase).toBe(false);expect(data.orders[0].tickets).toHaveLength(1);
  });
  it('accepts a transfer only once under concurrent requests without rotating the winning QR again',async()=>{
    const f=await fixture();const responses=await Promise.all([accept(claim('transfers',f.token)),accept(claim('transfers',f.token))]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const before=await env.DB.prepare('SELECT token FROM ticket_gate_credentials WHERE ticket_id=?').bind(`ticket-${f.id}`).first<{token:string}>();
    expect((await accept(claim('transfers',f.token))).status).toBe(409);
    expect(await env.DB.prepare('SELECT qr_token_hash FROM tickets WHERE id=?').bind(`ticket-${f.id}`).first()).toEqual({qr_token_hash:await hashGateToken(before!.token)});
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM attendee_sessions WHERE attendee_id=?').bind(f.recipient).first()).toEqual({count:1});
  });
  for(const state of ['checked_in','voided','removed','suspended'] as const)it(`does not accept a ${state} ticket or recipient`,async()=>{
    const f=await fixture();
    if(state==='removed')await env.DB.prepare("UPDATE curated_event_records SET removed_at=? WHERE slug=?").bind(new Date().toISOString(),f.eventSlug).run();
    else if(state==='suspended')await env.DB.prepare("INSERT INTO attendee_profiles (id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES (?,?,'Suspended',?,'suspended',?,?)").bind(f.recipient,f.recipientEmail,...Array(3).fill(new Date().toISOString())).run();
    else await env.DB.prepare('UPDATE tickets SET status=? WHERE id=?').bind(state,`ticket-${f.id}`).run();
    expect((await accept(claim('transfers',f.token))).status).toBe(409);
    expect(await env.DB.prepare('SELECT attendee_id FROM ticket_assignments WHERE ticket_id=?').bind(`ticket-${f.id}`).first()).toEqual({attendee_id:f.sender});
    expect(await env.DB.prepare('SELECT 1 FROM ticket_gate_credentials WHERE ticket_id=?').bind(`ticket-${f.id}`).first()).toBeNull();
  });
  it('creates one session when a recovery link is submitted concurrently',async()=>{
    const f=await fixture(),grant=await f.recovery(f.senderEmail);
    const responses=await Promise.all([recover(claim('recovery',grant.token)),recover(claim('recovery',grant.token))]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM attendee_sessions WHERE attendee_id=?').bind(f.sender).first()).toEqual({count:2});
  });
  it('keeps the same valid QR when two devices prepare a new pass simultaneously',async()=>{
    const f=await fixture();const request=()=>new Request(`${origin}/api/customer/tickets`,{method:'POST',headers:{origin,cookie:f.cookie}});
    const responses=await Promise.all([wallet(request()),wallet(request())]);
    const data=await Promise.all(responses.map(r=>r.json())) as Array<{orders:Array<{tickets:Array<{qrPayload:string}>}>}>;
    expect(data[0].orders[0].tickets[0].qrPayload).toBe(data[1].orders[0].tickets[0].qrPayload);
    const credential=await env.DB.prepare('SELECT token FROM ticket_gate_credentials WHERE ticket_id=?').bind(`ticket-${f.id}`).first<{token:string}>();
    expect(await env.DB.prepare('SELECT qr_token_hash FROM tickets WHERE id=?').bind(`ticket-${f.id}`).first()).toEqual({qr_token_hash:await hashGateToken(credential!.token)});
  });
});
it('closes a Room connection if its session is revoked before a reaction',async()=>{
 const f=await fixture(),future=new Date(Date.now()+86400000).toISOString();
 const room=env.THE_ROOM.getByName(f.eventSlug),policy={eventSlug:f.eventSlug,eventTitle:'Ownership Test',startsAt:new Date().toISOString(),endsAt:future,readOnlyAt:future,readOnly:false};
 const message=await room.publishAnnouncement('Host','Welcome to the night',false,policy);
 const response=await room.fetch(new Request('https://room.internal/socket',{headers:{upgrade:'websocket','x-bct-room-authorized':'1','x-bct-session-id':`session-${f.id}`,'x-bct-attendee-id':f.sender,'x-bct-display-name':'Sender','x-bct-event-slug':f.eventSlug,'x-bct-event-title':'Ownership Test','x-bct-starts-at':policy.startsAt,'x-bct-ends-at':future,'x-bct-read-only-at':future}}));
 expect(response.status).toBe(101);const socket=response.webSocket!;socket.accept();
 const closed=new Promise<number>(resolve=>socket.addEventListener('close',e=>resolve(e.code),{once:true}));
 await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),`session-${f.id}`).run();
 socket.send(JSON.stringify({type:'reaction',messageId:message.id,emoji:'🔥'}));expect(await closed).toBe(4003);
});
