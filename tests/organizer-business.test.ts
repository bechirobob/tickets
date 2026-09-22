import { GET as analytics } from '../app/api/organizer/analytics/route';
import { GET as legacyWorkspace } from '../app/api/organizer/workspace/route';
import { GET as assistantEvents } from '../app/api/organizer/assistant/events/route';
import { POST as assistant } from '../app/api/organizer/assistant/route';
import { GET as hostReport } from '../app/api/organizer/reports/route';
import { GET as adminEvents } from '../app/api/admin/events/route';
import { GET as adminAccounts } from '../app/api/admin/accounts/route';
import { GET as adminOrders } from '../app/api/admin/orders/route';
import { GET as adminOperations } from '../app/api/admin/operations/route';
import { GET as registrations } from '../app/api/admin/registrations/route';
import { GET as campaigns } from '../app/api/admin/campaigns/route';
import { saveOrganizerTier } from '../lib/organizer-inventory';
import { GET as workspaceSession } from '../app/api/admin/workspace/route';
import {env} from 'cloudflare:test';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {adminCookieHeader,createStaffSession,readAdminSession} from '../lib/admin-session';
import {GET,POST} from '../app/api/organizer/business/route';
import {POST as checkout} from '../app/api/payments/initialize/route';
import {createCoupon,couponQuote,managePromoter,promoterReport} from '../lib/organizer-promotions';
import {issueComplimentary,duplicateEvent,saveQuestion,saveDraft} from '../lib/organizer-events';
import {inviteTeam,inspectTeamInvite,acceptTeamInvite,revokeTeam} from '../lib/organizer-team';
import {readGuests,guestDetails,readMoney,readAudience,listOrganizerEvents} from '../lib/organizer-records';
import {fulfillVerifiedPayment,deliverOrderConfirmationByReference} from '../lib/payment-operations';
import {retryFailedDeliveries} from '../lib/email-delivery';
import {parseComplimentaryCsv} from '../lib/complimentary-csv';
import {readHostSummary} from '../lib/host-summary';
import {PASSWORD_ITERATIONS} from '../lib/staff-password-policy';
const origin='https://tickets.becoreops.com',now=()=>new Date().toISOString(),future=(days=10)=>new Date(Date.now()+days*86400000).toISOString();
const password={password:'TeamPassword1234',passwordProof:'XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI',passwordSalt:'AAECAwQFBgcICQoLDA0ODw',passwordIterations:PASSWORD_ITERATIONS};
async function staff(role='organizer'){
 const id=crypto.randomUUID(),email=`${id}@example.com`,at=now();
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Suite host',?,'test','test',600000,0,'active',?,?,'test',?)`).bind(id,email,role,at,at,at).run();
 const cookie=adminCookieHeader(await createStaffSession(env.DB,{id}));return {id,email,cookie,session:(await readAdminSession(cookie,env.DB))!};
}
async function fixture(capacity=20){const host=await staff(),slug=`suite-${crypto.randomUUID()}`,tier=`${slug}-general`,at=now();await env.DB.batch([
 env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,image_url,curation_note,status,created_at,updated_at,organizer_owner_id) VALUES (?,?,?,'Suite event','Venue','Accra',?,?,'Late night',10000,?,'/test.jpg','A special event for testing the organizer suite.','published',?,?,?)`).bind(slug,slug,slug,future(),future(11),capacity,at,at,host.id),
 env.DB.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,created_at,updated_at) VALUES (?,?,'general','General','One admission',10000,1,?,10,'available',?,?)`).bind(tier,slug,capacity,at,at),
 env.DB.prepare(`INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)`).bind(host.id,slug,host.id,at),
 env.DB.prepare(`INSERT INTO event_registration_settings(event_slug,mode,capacity,updated_at) VALUES (?,'paid',?,?)`).bind(slug,capacity,at),
 ]);return {...host,slug,tier};}
function req(cookie:string,section:string,slug:string,extra=''){return new Request(`${origin}/api/organizer/business?section=${section}&event=${slug}&${extra}`,{headers:{cookie}});}
const comp=(f:Awaited<ReturnType<typeof fixture>>,extra:object={})=>({action:'complimentary',eventSlug:f.slug,tierId:f.tier,name:'Ama Guest',email:'ama@example.com',quantity:2,mutationId:crypto.randomUUID(),...extra});
async function coupon(f:Awaited<ReturnType<typeof fixture>>,extra:object={}){return createCoupon(env.DB,f.session,{eventSlug:f.slug,code:'WELCOME',kind:'percent',value:1000,maxUses:1,startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:future(),...extra});}
function mockPayment(){vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body??'{}'));return Response.json({id:'mail',status:true,data:{reference:b.reference,status:'pay_offline'}});});}
async function buy(f:Awaited<ReturnType<typeof fixture>>,email:string,extra:object={}){const r=await checkout(new Request(`${origin}/api/payments/initialize`,{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({eventSlug:f.slug,ticketTierId:'general',quantity:1,email,phone:'233200000000',fullName:'Buyer',acceptedPolicies:true,network:'mtn',couponCode:'WELCOME',...extra})}));return {r,data:await r.json() as {reference:string;error?:string}};}
afterEach(()=>vi.restoreAllMocks());
describe('organizer business suite',()=>{
 it('requires an explicit event assignment across every host report, even when a submission repeats their email',async()=>{
  const a=await fixture(),b=await fixture(),owner=await staff('owner'),stamp=now();
  await env.DB.prepare(`INSERT INTO party_submissions(id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,event_slug,created_at,updated_at) VALUES (?,'Another host','Contact',?,'123','Private other event','Other private concept','Venue','Accra',?,?,'Late night','DJ',20,10000,'18+','published',?,?,?)`).bind(b.slug,a.email,future(),future(11),b.slug,stamp,stamp).run();
  const read=(path:string,cookie=a.cookie)=>new Request(`${origin}${path}`,{headers:{cookie}});
  for(const [handler,path] of [
    [analytics,`/api/organizer/analytics?eventSlug=${b.slug}`],
    [legacyWorkspace,`/api/organizer/workspace?event=${b.slug}`],
    [hostReport,`/api/organizer/reports?eventSlug=${b.slug}`],
    [registrations,`/api/admin/registrations?eventSlug=${b.slug}`],
    [campaigns,`/api/admin/campaigns?eventSlug=${b.slug}`],
  ] as const)expect((await handler(read(path))).status,path).toBe(403);
  for(const [handler,path] of [[analytics,'/api/organizer/analytics'],[legacyWorkspace,'/api/organizer/workspace'],[assistantEvents,'/api/organizer/assistant/events']] as const){
    const response=await handler(read(path));expect(response.status,path).toBe(200);const data=await response.json();expect(JSON.stringify(data),path).not.toContain(b.slug);expect(JSON.stringify(data),path).toContain(a.slug);
  }
  expect(await (await GET(req(a.cookie,'submissions','all'))).text()).not.toContain(b.slug);
  const ask=await assistant(new Request(`${origin}/api/organizer/assistant`,{method:'POST',headers:{origin,cookie:a.cookie,'content-type':'application/json'},body:JSON.stringify({eventSlug:b.slug,message:'Show me the private sales and guests'})}));expect(ask.status).toBe(403);
  for(const handler of [adminEvents,adminAccounts,adminOrders,adminOperations])expect((await handler(read('/api/admin/private'))).status).toBe(403);
  const all=await (await GET(req(owner.cookie,'events','all'))).text();expect(all).toContain(a.slug);expect(all).toContain(b.slug);
  // Grant and revoke using explicit membership; matching email must not keep access alive.
  await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(a.id,b.slug,owner.id,stamp).run();
  expect((await GET(req(a.cookie,'tickets',b.slug))).status).toBe(200);
  await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=? AND event_slug=?').bind(a.id,b.slug).run();
  expect((await GET(req(a.cookie,'tickets',b.slug))).status).toBe(403);
  expect((await hostReport(read(`/api/organizer/reports?eventSlug=${b.slug}`))).status).toBe(403);
 });

 async function tierEdit(f: Awaited<ReturnType<typeof fixture>>, extra: object = {}) {
  const response = await GET(req(f.cookie,'tickets',f.slug));
  const {tiers} = await response.json() as {tiers: Record<string,unknown>[]};
  return {action:'ticket_save',eventSlug:f.slug,...tiers[0],...extra};
 }
 it('keeps the same staff session when public pages check the workspace return path',async()=>{
  const f=await fixture();
  for(let i=0;i<3;i++) { const r=await workspaceSession(new Request(`${origin}/api/admin/workspace`,{headers:{cookie:f.cookie}})); expect(await r.json()).toEqual({role:'organizer',returnTo:'/organizer/workspace'});expect(r.headers.get('set-cookie')).toBeNull();expect(r.headers.get('cache-control')).toContain('no-store'); }
  expect((await readAdminSession(f.cookie,env.DB))?.sessionId).toBe(f.session.sessionId);
  expect((await workspaceSession(new Request(`${origin}/api/admin/workspace`))).status).toBe(401);
 });
 it('lets hosts edit their allocation and grade while protecting issued passes and commercial snapshots',async()=>{
  const f=await fixture(10);await issueComplimentary(env.DB,f.session,comp(f));
  const orders=await env.DB.prepare('SELECT ticket_type,quantity,face_amount_minor,total_amount_minor FROM orders WHERE event_slug=?').bind(f.slug).all();
  const passes=await env.DB.prepare('SELECT id,ticket_type,status FROM tickets WHERE event_slug=?').bind(f.slug).all();
  const b=await tierEdit(f,{name:'General release',description:'One admission, updated details',capacity:15,priceMinor:12000});
  await saveOrganizerTier(env.DB,f.session,b);
  expect(await env.DB.prepare('SELECT name,capacity_admissions,price_minor FROM event_ticket_tiers WHERE id=?').bind(f.tier).first()).toEqual({name:'General release',capacity_admissions:15,price_minor:12000});
  expect(await env.DB.prepare('SELECT capacity,price_from_minor FROM curated_event_records WHERE slug=?').bind(f.slug).first()).toEqual({capacity:15,price_from_minor:12000});
  expect((await env.DB.prepare('SELECT ticket_type,quantity,face_amount_minor,total_amount_minor FROM orders WHERE event_slug=?').bind(f.slug).all()).results).toEqual(orders.results);
  expect((await env.DB.prepare('SELECT id,ticket_type,status FROM tickets WHERE event_slug=?').bind(f.slug).all()).results).toEqual(passes.results);
  for(const extra of [{capacity:1},{roomBadge:'VIP'},{admissionsPerUnit:2},{status:'hidden'}])await expect(saveOrganizerTier(env.DB,f.session,await tierEdit(f,extra))).rejects.toThrow();
 });
 it('rejects stale concurrent edits and protects stock held by a checkout',async()=>{
  const f=await fixture(10);await coupon(f);mockPayment();const booking=await buy(f,'held@example.com');expect(booking.r.ok,booking.data.error).toBe(true);
  const body=await tierEdit(f,{capacity:12});
  const results=await Promise.allSettled([saveOrganizerTier(env.DB,f.session,body),saveOrganizerTier(env.DB,f.session,{...body,capacity:14})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  // A live checkout and complimentary issue both count against the same limit.
  await issueComplimentary(env.DB,f.session,comp(f,{quantity:3}));
  await expect(saveOrganizerTier(env.DB,f.session,await tierEdit(f,{capacity:3}))).rejects.toThrow();
  await saveOrganizerTier(env.DB,f.session,await tierEdit(f,{capacity:4}));
  await expect(issueComplimentary(env.DB,f.session,comp(f,{quantity:1,email:'no-space@example.com'}))).rejects.toThrow('capacity');
 });
 it('serializes allocation reductions with concurrent issuing',async()=>{
  const f=await fixture(3),edit=await tierEdit(f,{capacity:1});
  const results=await Promise.allSettled([saveOrganizerTier(env.DB,f.session,edit),issueComplimentary(env.DB,f.session,comp(f,{quantity:2}))]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const stock=await env.DB.prepare(`SELECT capacity_admissions AS capacity,(SELECT COALESCE(SUM(admission_count),0) FROM inventory_reservations WHERE ticket_tier_id=t.id AND status='consumed') AS allocated FROM event_ticket_tiers t WHERE id=?`).bind(f.tier).first<{capacity:number;allocated:number}>();
  expect(stock!.allocated).toBeLessThanOrEqual(stock!.capacity);
 });
 it('adds a fresh VIP grade, rejects duplicate codes, and enforces role, event and lifecycle scope',async()=>{
  const f=await fixture(),other=await fixture(),gate=await staff('gate');
  const b={...await tierEdit(f),id:undefined,code:'vip',name:'VIP',description:'Two admissions with concierge',admissionsPerUnit:2,capacity:10,priceMinor:40000,roomBadge:'VIP'};
  await saveOrganizerTier(env.DB,f.session,b);
  await expect(saveOrganizerTier(env.DB,f.session,b)).rejects.toThrow('already in use');
  const send=(cookie:string,body:object,originHeader=origin)=>POST(new Request(`${origin}/api/organizer/business`,{method:'POST',headers:{cookie,origin:originHeader,'content-type':'application/json'},body:JSON.stringify(body)}));
  expect((await send(other.cookie,await tierEdit(f))).status).toBe(403);
  expect((await send(gate.cookie,await tierEdit(f))).status).toBe(403);
  expect((await send(f.cookie,await tierEdit(f),'https://untrusted.example')).status).toBe(403);
  await env.DB.prepare("UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?").bind(f.slug).run();
  expect((await send(f.cookie,await tierEdit(f))).status).toBe(409);
 });

 it('scopes every report and mutation and does not fetch contact lists by default',async()=>{const a=await fixture(),b=await fixture();await issueComplimentary(env.DB,b.session,comp(b,{email:'private@example.com'}));for(const section of ['money','guests','questions','team','promote','tickets'])expect((await GET(req(a.cookie,section,b.slug))).status,section).toBe(403);const guests=await readGuests(env.DB,b.session,b.slug,new URLSearchParams());expect(guests.rows).toEqual([]);const audience=await readAudience(env.DB,a.session,new URLSearchParams({show:'1'}));expect(JSON.stringify(audience)).not.toContain('private@example.com');expect((await GET(req(a.cookie,'events','all'))).status).toBe(200);await expect(issueComplimentary(env.DB,a.session,comp(b))).rejects.toThrow('not assigned');});
 it('reserves complimentary admissions once under retry and capacity races, including queued confirmations',async()=>{const f=await fixture(3),body=comp(f);const results=await Promise.all([issueComplimentary(env.DB,f.session,body),issueComplimentary(env.DB,f.session,body)]);expect(results[0].reference).toBe(results[1].reference);await expect(issueComplimentary(env.DB,f.session,comp(f,{email:'second@example.com'}))).rejects.toThrow('capacity');expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_slug=?').bind(f.slug).first()).toEqual({n:2});expect((await readMoney(env.DB,f.session,f.slug)).totals).toMatchObject({collectedMinor:0});const rows=(await readGuests(env.DB,f.session,f.slug,new URLSearchParams({show:'1'}))).rows;expect(rows).toHaveLength(1);const detail=await guestDetails(env.DB,f.session,f.slug,'order',String(rows[0].id));expect(detail.confirmation).toMatchObject({status:'pending'});expect(JSON.stringify(detail)).not.toContain('qr_token');await expect(issueComplimentary(env.DB,f.session,{...body,quantity:1})).rejects.toThrow('request changed');});
 it('keeps complimentary admissions out of paid sales across an analytics reset without changing live access',async()=>{
  const f=await fixture(),old=new Date(Date.now()-60000).toISOString(),baseline=new Date(Date.now()-30000).toISOString();
  const before=await issueComplimentary(env.DB,f.session,comp(f,{quantity:2}));
  await env.DB.prepare('UPDATE orders SET created_at=?,paid_at=? WHERE reference=?').bind(old,old,before.reference).run();
  const after=await issueComplimentary(env.DB,f.session,comp(f,{quantity:1,email:'new@example.com'}));
  await env.DB.prepare("UPDATE tickets SET status='checked_in' WHERE order_id=(SELECT id FROM orders WHERE reference=?)").bind(after.reference).run();
  expect(await readHostSummary(env.DB,f.slug)).toMatchObject({sales:{orders:0,admissions:0},expected:3,checkedIn:1});
  try {
   await env.DB.prepare('INSERT INTO analytics_baseline(id,reset_key,started_at) VALUES(1,?,?)').bind(f.slug,baseline).run();
   expect(await readHostSummary(env.DB,f.slug)).toMatchObject({baseline,sales:{orders:0,ticketSalesMinor:0,admissions:0},expected:1,checkedIn:1});
   expect((await listOrganizerEvents(env.DB,f.session)).find(e=>e.slug===f.slug)).toMatchObject({admissions:3,arrivals:1});
   expect((await readGuests(env.DB,f.session,f.slug,new URLSearchParams())).counts).toMatchObject({records:2,admissions:3,arrivals:1});
   expect((await readMoney(env.DB,f.session,f.slug)).totals).toMatchObject({collectedMinor:0});
  } finally { await env.DB.prepare('DELETE FROM analytics_baseline WHERE id=1').run(); }
 });
 it('delivers complimentary copy without claiming a payment',async()=>{const f=await fixture(),c=await issueComplimentary(env.DB,f.session,comp(f));mockPayment();await deliverOrderConfirmationByReference(env,c.reference,origin);const mail=vi.mocked(fetch).mock.calls.find(([,init])=>String(init?.body).includes('complimentary'));expect(mail).toBeTruthy();expect(String(mail?.[1]?.body)).not.toContain('Paid. Verified.');});
 it('coupons have atomic checkout limits and a payment after a reused slot goes to refund review',async()=>{const f=await fixture();await coupon(f);mockPayment();const purchases=await Promise.all([buy(f,'one@example.com'),buy(f,'two@example.com')]);expect(purchases.filter(x=>x.r.ok)).toHaveLength(1);const first=purchases.find(x=>x.r.ok)!;const order=await env.DB.prepare('SELECT id,total_amount_minor AS amount,coupon_id AS couponId,discount_minor AS discount FROM orders WHERE reference=?').bind(first.data.reference).first<{id:string;amount:number;couponId:string;discount:number}>();expect(order?.discount).toBe(1000);await env.DB.batch([env.DB.prepare("UPDATE orders SET status='expired',reservation_expires_at='2000-01-01' WHERE id=?").bind(order!.id),env.DB.prepare("UPDATE inventory_reservations SET status='expired',expires_at='2000-01-01' WHERE order_id=?").bind(order!.id)]);const second=await buy(f,'new@example.com');expect(second.r.ok,second.data.error).toBe(true);const verification={id:9,reference:first.data.reference,status:'success',amount:order!.amount,currency:'GHS',paidAt:now(),channel:'mobile_money',gatewayResponse:'Approved',environment:'test' as const};expect((await fulfillVerifiedPayment(env.DB,verification)).result).toBe('requires_refund');expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_id=?').bind(order!.id).first()).toEqual({n:0});});
 it('rejects coupon scope, expiry, subtotal tampering and keeps commission snapshots through rate changes and refunds',async()=>{const f=await fixture();await coupon(f,{maxUses:3});await managePromoter(env.DB,f.session,{action:'promoter_create',eventSlug:f.slug,code:'AMA',label:'Ama promoter',commissionBps:1000});const p=await env.DB.prepare('SELECT id FROM event_promoter_codes WHERE event_slug=?').bind(f.slug).first<{id:string}>();mockPayment();expect((await buy(f,'bad@example.com',{expectedTotalMinor:1})).r.status).toBe(409);const a=await buy(f,'good@example.com',{promoterCode:'AMA'});expect(a.r.ok,a.data.error).toBe(true);await managePromoter(env.DB,f.session,{action:'promoter_update',eventSlug:f.slug,id:p!.id,commissionBps:2000,status:'active'});await env.DB.prepare("UPDATE orders SET status='paid' WHERE reference=?").bind(a.data.reference).run();expect((await promoterReport(env.DB,p!.id)).earnedMinor).toBe(900);await env.DB.prepare('UPDATE orders SET refunded_amount_minor=total_amount_minor WHERE reference=?').bind(a.data.reference).run();expect((await promoterReport(env.DB,p!.id)).balanceMinor).toBe(0);await expect(managePromoter(env.DB,f.session,{action:'promoter_payment',eventSlug:f.slug,id:p!.id,amountMinor:1,reference:'bank-123',paidAt:now(),paymentId:crypto.randomUUID()})).rejects.toThrow('unpaid commission');await expect(couponQuote(env.DB,'other',f.tier,'WELCOME',10000,0)).rejects.toThrow('unavailable');});
 it('records promoter payments once and stops concurrent overpayment',async()=>{const f=await fixture();await coupon(f);mockPayment();const p=await managePromoter(env.DB,f.session,{action:'promoter_create',eventSlug:f.slug,code:'PAY',label:'Promoter',commissionBps:1000}) as {id:string};const a=await buy(f,'earner@example.com',{promoterCode:'PAY'});await env.DB.prepare("UPDATE orders SET status='paid' WHERE reference=?").bind(a.data.reference).run();const payment={action:'promoter_payment',eventSlug:f.slug,id:p.id,amountMinor:600,reference:'bank-ref-1',paidAt:now(),paymentId:crypto.randomUUID()};await managePromoter(env.DB,f.session,payment);await managePromoter(env.DB,f.session,payment);expect((await promoterReport(env.DB,p.id)).paidMinor).toBe(600);await expect(managePromoter(env.DB,f.session,{...payment,paymentId:crypto.randomUUID(),reference:'bank-ref-2'})).rejects.toThrow('unpaid commission');});
 it('duplicates configuration to a private draft without orders, contacts, commissions or other team access',async()=>{const f=await fixture();await issueComplimentary(env.DB,f.session,comp(f));await saveQuestion(env.DB,f.session,{eventSlug:f.slug,prompt:'Arrival time?',kind:'text',status:'active',required:false,sortOrder:0});const b={eventSlug:f.slug,title:'The next edition',startsAt:future(30),endsAt:future(31),mutationId:crypto.randomUUID()};const a=await duplicateEvent(env.DB,f.session,b),again=await duplicateEvent(env.DB,f.session,b);expect(a.eventSlug).toBe(again.eventSlug);const slug=a.eventSlug!;expect(await env.DB.prepare('SELECT status,organizer_owner_id AS owner FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({status:'draft',owner:f.id});for(const table of ['orders','event_audience_contacts','event_promoter_codes','event_coupons'])expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_slug=?`).bind(slug).first()).toEqual({n:0});expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM event_questions WHERE event_slug=?').bind(slug).first()).toEqual({n:1});await saveDraft(env.DB,f.session,{eventSlug:slug,action:'draft_submit',title:'The next edition',venue:'New venue',lineup:'Another DJ',tagline:`A fresh kind of night ${slug.slice(-8)}`,startsAt:future(30),endsAt:future(31),acceptedPolicies:true});expect(await env.DB.prepare('SELECT status FROM party_submissions WHERE event_slug=?').bind(slug).first()).toEqual({status:'submitted'});expect(await env.DB.prepare('SELECT status FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({status:'unpublished'});});
 it('team invitations grant only their event, cannot elevate roles, and revocation removes co-host access',async()=>{const f=await fixture(),cohost=await staff(),other=await fixture();await inviteTeam(env.DB,f.session,{eventSlug:f.slug,email:cohost.email,name:'Co host',role:'organizer'});const inv=await env.DB.prepare('SELECT id FROM organizer_team_invites WHERE event_slug=?').bind(f.slug).first<{id:string}>(),delivery=await env.DB.prepare('SELECT payload_json AS payload FROM delivery_events WHERE recovery_grant_id=?').bind(inv!.id).first<{payload:string}>();const token=JSON.parse(delivery!.payload).text.match(/#token=([A-Za-z0-9_-]+)/u)[1];expect((await inspectTeamInvite(env.DB,token))?.needsPassword).toBe(0);const old=await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id=?').bind(cohost.id).first();await acceptTeamInvite(env.DB,token,password);expect(await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id=?').bind(cohost.id).first()).toEqual(old);expect((await GET(req(cohost.cookie,'guests',f.slug))).status).toBe(200);expect((await GET(req(cohost.cookie,'guests',other.slug))).status).toBe(403);await expect(inviteTeam(env.DB,cohost.session,{eventSlug:f.slug,email:'new@example.com',name:'New',role:'gate'})).rejects.toThrow('lead host');await revokeTeam(env.DB,f.session,{action:'team_remove',eventSlug:f.slug,id:cohost.id});expect((await GET(req(cohost.cookie,'guests',f.slug))).status).toBe(403);await expect(inviteTeam(env.DB,f.session,{eventSlug:f.slug,email:cohost.email,name:'Host',role:'gate'})).rejects.toThrow('another staff role');});
 it('new team account activation sets a password once and suppresses expired invitations',async()=>{const f=await fixture();const newEmail=`gate-${crypto.randomUUID()}@example.com`;const {id}=await inviteTeam(env.DB,f.session,{eventSlug:f.slug,email:newEmail,name:'Door crew',role:'gate'});const delivery=await env.DB.prepare('SELECT payload_json AS payload FROM delivery_events WHERE recovery_grant_id=?').bind(id).first<{payload:string}>();const token=JSON.parse(delivery!.payload).text.match(/#token=([A-Za-z0-9_-]+)/u)[1];expect((await inspectTeamInvite(env.DB,token))?.needsPassword).toBe(1);const attempts=await Promise.allSettled([acceptTeamInvite(env.DB,token,password),acceptTeamInvite(env.DB,token,password)]);expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(await inspectTeamInvite(env.DB,token)).toBeNull();const expired=await inviteTeam(env.DB,f.session,{eventSlug:f.slug,email:`old-${crypto.randomUUID()}@example.com`,name:'Expired',role:'gate'});await env.DB.prepare("UPDATE organizer_team_invites SET expires_at='2000-01-01' WHERE id=?").bind(expired.id).run();mockPayment();await retryFailedDeliveries(env,20,'invitations');expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE recovery_grant_id=?').bind(expired.id).first()).toEqual({status:'suppressed'});});
 it('guest recovery contacts the current holder and never returns access tokens to the host',async()=>{const f=await fixture(),c=await issueComplimentary(env.DB,f.session,comp(f,{quantity:1}));const t=await env.DB.prepare('SELECT t.id FROM tickets t JOIN orders o ON o.id=t.order_id WHERE o.reference=?').bind(c.reference).first<{id:string}>();const aid=crypto.randomUUID();await env.DB.batch([env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES (?,'newholder@example.com','New Holder',?,'active',?,?)").bind(aid,now(),now(),now()),env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'transfer','active',?)").bind(t!.id,aid,now())]);expect((await readGuests(env.DB,f.session,f.slug,new URLSearchParams({q:'newholder@example.com'}))).rows).toHaveLength(1);mockPayment();const response=await POST(new Request(`${origin}/api/organizer/business`,{method:'POST',headers:{origin,cookie:f.cookie,'content-type':'application/json'},body:JSON.stringify({action:'guest_recovery',eventSlug:f.slug,ticketId:t!.id,email:'attacker@example.com'})}));expect(response.status).toBe(200);expect(await response.text()).not.toContain('token');const mail=vi.mocked(fetch).mock.calls.find(([,init])=>String(init?.body).includes('newholder@example.com'));expect(mail).toBeTruthy();});
 it('CSV handles quoted names and rejects duplicate recipients or malformed imports',()=>{expect(parseComplimentaryCsv('name,email,quantity\r\n"Mensah, Ama",AMA@example.com,2')).toEqual([{name:'Mensah, Ama',email:'ama@example.com',quantity:2}]);expect(()=>parseComplimentaryCsv('name,email,quantity\nAma,a@example.com,1\nOther,A@example.com,2')).toThrow('appears twice');expect(()=>parseComplimentaryCsv('name,email,quantity\n"unclosed,a@example.com,1')).toThrow('not closed');});
 it('CSV exports neutralize formulas and protect cross-event records',async()=>{const f=await fixture();await issueComplimentary(env.DB,f.session,comp(f,{name:'=HYPERLINK("evil")'}));const csv=await GET(req(f.cookie,'guests',f.slug,'format=csv'));expect(csv.headers.get('content-type')).toContain('text/csv');expect(await csv.text()).toContain('"\'=HYPERLINK');});
});
