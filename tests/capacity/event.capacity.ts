import { env } from 'cloudflare:test';
import { afterAll, expect, it, vi } from 'vitest';
import { POST as initialize } from '../../app/api/payments/initialize/route';
import { POST as webhook } from '../../app/api/payments/seevplus/webhook/route';
import { POST as claim } from '../../app/api/customer/session/route';
import { GET as nights } from '../../app/api/customer/my-nights/route';
import { POST as wallet } from '../../app/api/customer/tickets/route';
import { POST as scan } from '../../app/api/admin/check-in/route';
import { adminCookieHeader, createStaffSession } from '../../lib/admin-session';
import { readAttendeeRoomAccess } from '../../lib/attendee-auth';

const origin = 'https://tickets.becoreops.com'; // Request origin validation only; never fetched.
const provider = 'https://api.seevplus.com/api/v1/developer/payments';
const count = 400;
const runtime = env as unknown as Cloudflare.Env;
const metrics: Record<string, unknown>[] = [];
const latencyFailures: string[] = [];
const sockets: WebSocket[] = [];
const providers = new Map<string, { amount: number; redirect_url: string; meta: { orderId: string } }>();
const cookies: string[] = [], qr: string[] = [];
const slug = `capacity-${crypto.randomUUID()}`;
const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString();
function req(path: string, data?: unknown, cookie?: string, extra?: Record<string, string>) {
  return new Request(`${origin}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
function percentile(times: number[], fraction: number) { return Math.round([...times].sort((a,b) => a-b)[Math.max(0, Math.ceil(times.length * fraction)-1)] ?? 0); }
async function burst<T>(name: string, n: number, action: (i: number) => Promise<T>) {
  const started = performance.now(), times: number[] = [], errors: string[] = [];
  const output = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const start = performance.now();
    try { return await action(i); } catch (error) { errors.push(String(error).slice(0, 200)); return undefined; }
    finally { times.push(performance.now() - start); }
  }));
  const elapsed = performance.now() - started;
  const result = { name, operations: n, concurrency: n, elapsedMs: Math.round(elapsed), p50Ms: percentile(times,.5), p95Ms: percentile(times,.95), p99Ms: percentile(times,.99), operationsPerSecond: +(n/(elapsed/1000)).toFixed(1), failures: errors.length, firstErrors: errors.slice(0,3) };
  metrics.push(result); console.log(`CAPACITY_PHASE ${JSON.stringify(result)}`);
  expect(errors, name).toEqual([]);
  const budgetMs = name.startsWith('my-nights') || name.startsWith('room-') || name.startsWith('wallet') || name.startsWith('gate') ? 5000 : 10000;
  if(result.p95Ms >= budgetMs) latencyFailures.push(`${name}: p95 ${result.p95Ms}ms exceeds ${budgetMs}ms`);
  return output as T[];
}
async function signed(reference: string, amount: number) {
  const timestamp = Math.floor(Date.now()/1000);
  const raw = JSON.stringify({ event: 'payment.succeeded', env: 'sandbox', data: { transaction: { reference, env: 'sandbox', amount: amount/100, status: 'completed' } } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(runtime.SEEV_WEBHOOK_SECRET), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${raw}`));
  return new Request(`${origin}/api/payments/seevplus/webhook`, { method:'POST', body:raw, headers:{'x-seev-timestamp':String(timestamp),'x-seev-signature':`v1=${[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}`} });
}
afterAll(() => {
  for (const socket of sockets) try { socket.close(1000,'Test complete'); } catch { /* Already closed. */ }
  vi.unstubAllGlobals();
  console.log(`CAPACITY_RESULTS ${JSON.stringify({ environment:'isolated local workerd and D1 on CI runner', attendees:count, provider:'in-process Seev and Resend mocks; no external calls', productionQuotasEnforced:false, metrics })}`);
});

it('400 distinct buyers: shared-IP checkout burst, signed callback replay, private passes and gate races', async ({ task }) => {
  (task.meta as { capacity?: unknown }).capacity = { environment: 'isolated local workerd and D1', attendees: count, provider: 'mocked Seev and Resend', productionQuotasEnforced: false, metrics };
  runtime.SEEV_ENABLED='true'; runtime.SEEV_ENVIRONMENT='sandbox'; runtime.SEEV_CHECKOUT_API_KEY='capacity-test-only'; runtime.SEEV_WEBHOOK_SECRET='capacity-test-only';
  vi.stubGlobal('fetch',vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url)===provider) {
      const data=JSON.parse(String(init?.body)); const ref=`PAY-${data.meta.orderId}`; providers.set(ref,data);
      return Response.json({success:true,data:{reference:ref,checkout_url:`https://pay.seevplus.com/${ref}`,amount:data.amount,currency:'GHS',env:'sandbox'}},{status:201});
    }
    if(String(url).startsWith(`${provider}/`)) {
      const ref=String(url).split('/').at(-1)!; const data=providers.get(ref); if(!data)throw Error('Unknown mock payment');
      return Response.json({success:true,data:{id:ref,reference:ref,status:'completed',amount:data.amount,final_amount:data.amount,currency:'GHS',env:'sandbox'}});
    }
    if(String(url)==='https://api.resend.com/emails') return Response.json({id:crypto.randomUUID()});
    throw Error(`External network prohibited in capacity test: ${String(url)}`);
  }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (?,?,?,'Capacity fixture','Test','Accra',?,?,'Late night',10000,400,'on_sale','https://example.com/test.jpg','Synthetic capacity verification only.','published',?,?,?)`).bind(slug,slug,slug,future,future,now,now,now),
    env.DB.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sort_order,created_at,updated_at) VALUES (?,?,'general','General','One admission',10000,1,400,1,'available',0,?,?)`).bind(slug,slug,now,now),
  ]);
  const checkout = (i: number) => initialize(req('/api/payments/initialize',{eventSlug:slug,ticketTierId:'general',quantity:1,fullName:`Guest ${i}`,email:`capacity-${i}@example.com`,phone:'0240000000',paymentMethod:'mobile_money',paymentProvider:'seevplus',network:'mtn',acceptedPolicies:true},undefined,{'idempotency-key':crypto.randomUUID(),'cf-connecting-ip':'192.0.2.40'}));
  const attempts = await burst('checkout-500-race-for-400-shared-ip',500,async i=>{const response=await checkout(i);expect([200,400,409],await response.clone().text()).toContain(response.status);return response.status;});
  expect(attempts.filter(status=>status===200)).toHaveLength(count);
  expect(attempts.filter(status=>status!==200)).toHaveLength(100);
  expect(providers.size).toBe(count);
  // Full event: further attempts must not reserve or issue extra admissions.
  await burst('sold-out-100-race',100,async i=>{const r=await checkout(i+500);expect(r.status,await r.clone().text()).toBe(400);expect((await r.json() as {error:string}).error).toMatch(/available|sold|left|ticket|admission/i);});
  expect(await env.DB.prepare("SELECT SUM(admission_count) AS total FROM inventory_reservations WHERE event_slug=? AND status='held'").bind(slug).first()).toEqual({total:count});
  const entries=[...providers.entries()];
  await burst('signed-webhooks-800-with-replays',count*2,async i=>{const [ref,data]=entries[i%count];const r=await webhook(await signed(ref,data.amount));expect(r.status).toBe(200);});
  expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM tickets WHERE event_slug=?').bind(slug).first()).toEqual({total:count});
  await burst('claim-400-sessions',count,async i=>{const [,data]=entries[i];const u=new URL(data.redirect_url);const r=await claim(req('/api/customer/session',{reference:u.searchParams.get('reference'),claim:u.searchParams.get('claim')}));expect(r.status).toBe(200);cookies[i]=r.headers.get('set-cookie')!.split(';')[0];});
  await burst('wallet-400-ownership',count,async i=>{const r=await wallet(req('/api/customer/tickets',{},cookies[i]));expect(r.status).toBe(200);const d=await r.json() as {orders:Array<{orderId:string;tickets:Array<{qrPayload:string}>}>};expect(d.orders).toHaveLength(1);expect(d.orders[0].orderId).toBe(entries[i][1].meta.orderId);expect(d.orders[0].tickets).toHaveLength(1);qr[i]=d.orders[0].tickets[0].qrPayload;});
  expect(new Set(qr).size).toBe(count);
  for (const n of [100,400,800]) await burst(`my-nights-${n}-in-flight`,n,async i=>{const r=await nights(req('/api/customer/my-nights',undefined,cookies[i%count]));expect(r.status).toBe(200);const d=await r.json() as {nights:Array<{eventSlug:string;ticketCount:number}>};expect(d.nights).toHaveLength(1);expect(d.nights[0]).toMatchObject({eventSlug:slug,ticketCount:1});});
  const staffId=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,failed_login_count,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Capacity gate','owner','test','test',1,0,'active',0,?,?,'test',?)`).bind(staffId,`${staffId}@example.com`,now,now,now).run();
  const staffCookie=adminCookieHeader(await createStaffSession(env.DB,{id:staffId})).split(';')[0];
  const outcomes=await burst('gate-800-simultaneous-double-scans',count*2,async i=>{const r=await scan(req('/api/admin/check-in',{code:qr[i%count],eventSlug:slug,gate:`Gate ${i%4}`},staffCookie));expect([200,409]).toContain(r.status);return r.status;});
  expect(outcomes.filter(s=>s===200)).toHaveLength(count);expect(outcomes.filter(s=>s===409)).toHaveLength(count);
  expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM gate_checkin_events WHERE event_slug=?').bind(slug).first()).toEqual({total:count});
  // Fresh reads must not write session activity on every request.
  const fresh = await env.DB.prepare('SELECT last_seen_at FROM attendee_sessions WHERE id=(SELECT claimed_session_id FROM order_access_grants WHERE order_id=?)').bind(entries[0][1].meta.orderId).first<{last_seen_at:string}>();
  await Promise.all(Array.from({length:25},()=>nights(req('/api/customer/my-nights',undefined,cookies[0]))));
  expect(await env.DB.prepare('SELECT last_seen_at FROM attendee_sessions WHERE id=(SELECT claimed_session_id FROM order_access_grants WHERE order_id=?)').bind(entries[0][1].meta.orderId).first()).toEqual(fresh);
  metrics.push({name:'session-activity-coalescing',repeatReads:25,activityTimestampUnchanged:true});
  await roomLoad();
  const abuseStatuses: number[]=[];
  for(let i=0;i<11;i++){
    const response=await initialize(req('/api/payments/initialize',{eventSlug:'not-a-real-capacity-event',email:`${slug}-abuse@example.com`,phone:'0240000000',acceptedPolicies:true},undefined,{'cf-connecting-ip':'192.0.2.99'}));
    abuseStatuses.push(response.status);
  }
  expect(abuseStatuses).toEqual([...Array(10).fill(400),429]);
  metrics.push({name:'customer-abuse-guard',attempts:11,blockedAttempt:11});
  expect(latencyFailures,'Latency budgets').toEqual([]);
});

async function roomLoad() {
  expect(cookies).toHaveLength(count);
  const room=env.THE_ROOM.getByName(slug);
  const access=await Promise.all(cookies.map(cookie=>readAttendeeRoomAccess(env.DB,cookie,slug)));
  const received=Array.from({length:count},()=>new Set<string>()), sent=new Map<string,number>(), deliveryTimes:number[]=[];
  let connectionErrors=0;
  const connect = async (i: number) => {
    const identity=(await readAttendeeRoomAccess(env.DB,cookies[i],slug))!;expect(identity).toBeTruthy();
    const r=await room.fetch(new Request('https://room.internal/socket',{headers:{upgrade:'websocket','x-bct-room-authorized':'1','x-bct-session-id':identity.sessionId!,'x-bct-attendee-id':identity.attendeeId,'x-bct-display-name':`Guest ${i}`,'x-bct-event-slug':slug,'x-bct-event-title':'Capacity fixture','x-bct-starts-at':now,'x-bct-ends-at':future,'x-bct-read-only-at':future}}));
    expect(r.status).toBe(101);const socket=r.webSocket!;sockets[i]=socket;
    socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.type==='error')connectionErrors++;if(data.type==='message' && sent.has(data.message.content)){received[i].add(data.message.content);deliveryTimes.push(performance.now()-sent.get(data.message.content)!);}});
    socket.addEventListener('error',()=>{connectionErrors++;});socket.accept();
  };
  await burst('room-connect-400',count,connect);
  // 2 messages/sec for 60s, delivered to all 400 recipients: 48,000 deliveries.
  const started=performance.now();
  for(let n=0;n<120;n++){const content=`load-message-${n}`;sent.set(content,performance.now());sockets[n%count].send(JSON.stringify({type:'message',content}));await new Promise(resolve=>setTimeout(resolve,500));}
  const deadline=performance.now()+30_000;
  while(received.some(messages=>messages.size<120) && performance.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
  const deliveries=received.reduce((sum,messages)=>sum+messages.size,0);
  const notificationRows=await env.DB.prepare("SELECT COUNT(*) AS total FROM attendee_notifications WHERE event_slug=? AND kind='room_message'").bind(slug).first<{total:number}>();
  const result={name:'room-400-sustained-60s',notificationRows:notificationRows?.total,messages:120,expectedDeliveries:48000,deliveries,elapsedMs:Math.round(performance.now()-started),p95DeliveryMs:percentile(deliveryTimes,.95),p99DeliveryMs:percentile(deliveryTimes,.99),connectionErrors};metrics.push(result);console.log(`CAPACITY_PHASE ${JSON.stringify(result)}`);
  expect(deliveries).toBe(48000);expect(connectionErrors).toBe(0);expect(result.p95DeliveryMs).toBeLessThan(5000);
  const revoked=sockets[399];let leaked=false;
  const closed=new Promise<number>(resolve=>revoked.addEventListener('close',e=>resolve(e.code),{once:true}));
  revoked.addEventListener('message',e=>{if(String(e.data).includes('after-revocation'))leaked=true;});
  await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(now,access[399]!.sessionId).run();
  sockets[0].send(JSON.stringify({type:'message',content:'after-revocation'}));
  expect(await closed).toBe(4003);expect(leaked).toBe(false);
  metrics.push({name:'room-revocation-under-load',privateLeak:false,closeCode:4003});
  const disconnectStart=performance.now();
  await Promise.all(sockets.slice(0,399).map(socket=>new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Room close handshake exceeded 10 seconds')),10_000);
    socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});socket.close(1000,'Simulated reconnect');
  })));
  metrics.push({name:'room-disconnect-399',elapsedMs:Math.round(performance.now()-disconnectStart)});
  await burst('room-reconnect-399',399,connect);
  expect(await readAttendeeRoomAccess(env.DB,cookies[399],slug)).toBeNull();
  // Check recovery after the burst, not merely that all upgrades returned 101.
  const marker='after-reconnect';sent.set(marker,performance.now());
  sockets[0].send(JSON.stringify({type:'message',content:marker}));
  const recoveryDeadline=performance.now()+10_000;
  while(received.slice(0,399).some(messages=>!messages.has(marker)) && performance.now()<recoveryDeadline) await new Promise(resolve=>setTimeout(resolve,25));
  expect(received.slice(0,399).filter(messages=>messages.has(marker))).toHaveLength(399);
  metrics.push({name:'room-reconnect-delivery',expected:399,delivered:399,revokedGuestDenied:true});
}
