import { env } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { GET as myNights } from '../app/api/customer/my-nights/route';
import { POST as passes } from '../app/api/customer/tickets/route';
import { GET as wallet } from '../app/api/customer/wallet/[ticketId]/route';
import { GET as refreshWallet } from '../app/api/wallet/apple/v1/passes/[passTypeIdentifier]/[serialNumber]/route';
import { createSecureToken, hashToken } from '../lib/attendee-auth';
import { appleWalletAuthenticationToken, appleWalletPassSerial } from '../lib/apple-wallet-updates';
import { sendEmail, retryFailedDeliveries } from '../lib/email-delivery';

const origin = 'https://tickets.becoreops.com';
const runtime = env as unknown as Cloudflare.Env;
const walletKeys = ['APPLE_WALLET_SIGNER_URL','APPLE_WALLET_SIGNER_TOKEN','APPLE_WALLET_AUTH_SECRET','APPLE_WALLET_PASS_TYPE_IDENTIFIER','APPLE_WALLET_PUSH_URL'] as const;
afterEach(() => { vi.unstubAllGlobals(); for (const key of walletKeys) delete runtime[key]; });
async function booking() {
  const id = crypto.randomUUID(), now = new Date().toISOString(), future = new Date(Date.now()+86400000).toISOString(), token = createSecureToken();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (?,?,?,'Audit night','Venue','Accra',?,?,'Night',10000,10,'sold_out','/poster.jpg','Audit fixture','published',?,?,?)`).bind(id,id,id,future,future,now,now,now),
    env.DB.prepare(`INSERT INTO attendee_profiles (id,normalized_email,display_name,status,created_at,updated_at) VALUES (?,?,'Audit guest','active',?,?)`).bind(id,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)`).bind(id,id,await hashToken(token),future,now,now),
    env.DB.prepare(`INSERT INTO orders (id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES (?,?,?,'general',1,10000,0,10000,'GHS',?,'233000000000','mobile_money','paid',?,?)`).bind(id,id,id,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO tickets (id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',1,?,'issued',?)`).bind(id,id,id,id,now),
    env.DB.prepare(`INSERT INTO ticket_assignments (ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'audit','active',?)`).bind(id,id,now),
  ]);
  const cookie = `bct_attendee=${token}`;
  const read = async () => (await passes(new Request(`${origin}/api/customer/tickets`,{method:'POST',headers:{origin,cookie}}))).json() as Promise<{orders:Array<{roomAccess:boolean;tickets:Array<{status:string;qrPayload:string|null;gateCode:string|null}>}>}>;
  return {id,cookie,read};
}
for (const status of ['refund_pending','refunded','requires_refund','disputed']) it(`does not present a stale issued ticket as usable when payment is ${status}`, async () => {
  const b = await booking();
  expect((await b.read()).orders[0].tickets[0].qrPayload).toBeTruthy();
  await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind(status,b.id).run();
  const order = (await b.read()).orders[0];
  expect(order.tickets[0]).toMatchObject({status:'unavailable',qrPayload:null,gateCode:null});
  expect(order.roomAccess).toBe(false);
  const nights=await (await myNights(new Request(`${origin}/api/customer/my-nights`,{headers:{cookie:b.cookie}}))).json() as {nights:Array<{admissionActive:boolean;roomAccess:boolean}>};
  expect(nights.nights[0]).toMatchObject({admissionActive:false,roomAccess:false});
});
it('serves a sold-out event pass from the real attendee table and invalidates its Apple update after payment changes',async()=>{
  const b=await booking(); await b.read();
  Object.assign(runtime,{APPLE_WALLET_SIGNER_URL:'https://signer.example/pass',APPLE_WALLET_SIGNER_TOKEN:'fixture',APPLE_WALLET_AUTH_SECRET:'fixture-wallet-secret-long-enough',APPLE_WALLET_PASS_TYPE_IDENTIFIER:'pass.com.becoreops.tickets',APPLE_WALLET_PUSH_URL:'https://signer.example/push'});
  const payloads:Array<{status?:string;qrPayload:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{payloads.push(JSON.parse(String(init?.body)));return new Response('pkpass');}));
  const response=await wallet(new Request(`${origin}/api/customer/wallet/${b.id}?platform=apple`,{headers:{cookie:b.cookie}}),{params:Promise.resolve({ticketId:b.id})});
  expect(response.status).toBe(200);expect(payloads[0].qrPayload).toMatch(/^BCT:/u);
  const serial=await appleWalletPassSerial(b.id,b.id), passTypeIdentifier=runtime.APPLE_WALLET_PASS_TYPE_IDENTIFIER!;
  const authorization=`ApplePass ${await appleWalletAuthenticationToken(runtime,serial)}`;
  const update=(since?:string)=>refreshWallet(new Request(`${origin}/api/wallet/apple/v1/passes/${passTypeIdentifier}/${serial}`,{headers:{authorization,...(since?{'if-modified-since':since}:{})}}),{params:Promise.resolve({passTypeIdentifier,serialNumber:serial})});
  const first=await update();expect(first.status).toBe(200);const modified=first.headers.get('last-modified')!;
  await env.DB.prepare("UPDATE orders SET status='disputed' WHERE id=?").bind(b.id).run();
  expect((await update(modified)).status).toBe(200);expect(payloads.at(-1)).toMatchObject({status:'voided',qrPayload:`becore-tickets:void:${serial}`});
  expect((await wallet(new Request(`${origin}/api/customer/wallet/${b.id}?platform=apple`,{headers:{cookie:b.cookie}}),{params:Promise.resolve({ticketId:b.id})})).status).toBe(404);
});
it('defers a receipt on provider quota without exhausting its retry budget',async()=>{
  const id=crypto.randomUUID(),key=`receipt/${id}`;
  const provider=vi.fn(async()=>Response.json({name:'daily_quota_exceeded',message:'Daily quota reached'},{status:429}));vi.stubGlobal('fetch',provider);
  await sendEmail({db:env.DB,kind:'payment_confirmation',recipient:'audit@example.com',subject:'Receipt',text:'Confirmed',html:'<p>Confirmed</p>',idempotencyKey:key,deliveryId:id});
  expect(await env.DB.prepare('SELECT attempt_count AS attempts,next_attempt_at AS next FROM delivery_events WHERE id=?').bind(id).first()).toMatchObject({attempts:0,next:expect.any(String)});
  await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2020-01-01T00:00:00Z' WHERE id=?").bind(id).run();
  await retryFailedDeliveries(runtime);
  expect(await env.DB.prepare('SELECT attempt_count AS attempts FROM delivery_events WHERE id=?').bind(id).first()).toEqual({attempts:0});
  provider.mockResolvedValue(Response.json({id:'receipt-provider'}));
  await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2020-01-01T00:00:00Z' WHERE id=?").bind(id).run();
  await retryFailedDeliveries(runtime);
  expect(await env.DB.prepare('SELECT status,attempt_count AS attempts FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'sent',attempts:1});
});
for (const kind of ['ticket_recovery','ticket_transfer','waitlist_offer','registration_access'] as const) it(`suppresses a delayed ${kind} when its access grant no longer exists`,async()=>{
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO delivery_events (id,kind,recipient,recovery_grant_id,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at) VALUES (?,?,'audit@example.com',?,'failed',0,?,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')").bind(id,kind,id,JSON.stringify({subject:'Access',text:'Private link',html:'<p>Private link</p>',idempotencyKey:`${kind}/${id}`})).run();
  const provider=vi.fn();vi.stubGlobal('fetch',provider);
  await retryFailedDeliveries(runtime);
  expect(provider).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status,next_attempt_at FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'suppressed',next_attempt_at:null});
});
