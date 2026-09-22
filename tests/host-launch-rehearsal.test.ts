import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adminCookieHeader,createStaffSession } from '../lib/admin-session';
import { PASSWORD_ITERATIONS,bytesToBase64Url } from '../lib/staff-password-policy';
import { PATCH as curate } from '../app/api/admin/submissions/route';
import { POST as activate } from '../app/api/organizer/activate/route';
import { POST as login } from '../app/api/admin/session/route';
import { GET as workspace } from '../app/api/organizer/workspace/route';
import { POST as hostRegistration } from '../app/api/admin/registrations/route';
import { POST as signup } from '../app/api/registrations/route';
import { POST as passes } from '../app/api/customer/tickets/route';
import { POST as scan } from '../app/api/admin/check-in/route';
import { POST as initialize } from '../app/api/payments/initialize/route';
import { POST as claimPaid } from '../app/api/customer/session/route';
import { readHostSummary } from '../lib/host-summary';
import { processOrganizerReports } from '../lib/organizer-reports';
const origin='https://tickets.becoreops.com';
const runtime=env as unknown as Record<string,string>;
let checkout:{amount:number;redirect_url:string};
const providerRef=`PAY-${crypto.randomUUID()}`;
function req(path:string,body?:object,cookie='',method='POST'){return new Request(origin+path,{method:body?method:'GET',headers:{origin,cookie,'content-type':'application/json','idempotency-key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});}
async function staff(role:string) {
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Rehearsal staff',?,'test','test',1,0,'active',?,?,'fixture',?)`).bind(id,`${id}@example.com`,role,now,now,now).run();
 return {id,cookie:adminCookieHeader(await createStaffSession(env.DB,{id}))};
}
beforeEach(async()=>{
 await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE role='organizer'").run();
 runtime.SEEV_ENABLED='true';runtime.SEEV_ENVIRONMENT='sandbox';runtime.SEEV_CHECKOUT_API_KEY='test-only';
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  if(String(url)==='https://api.resend.com/emails')return Response.json({id:crypto.randomUUID()});
  if(String(url)==='https://api.seevplus.com/api/v1/developer/payments'){checkout=JSON.parse(String(init?.body));return Response.json({success:true,data:{reference:providerRef,checkout_url:`https://pay.seevplus.com/${providerRef}`,amount:checkout.amount,currency:'GHS',env:'sandbox'}},{status:201});}
  if(String(url).startsWith('https://api.seevplus.com/api/v1/developer/payments/'))return Response.json({success:true,data:{id:'rehearsal-payment',reference:providerRef,status:'completed',amount:checkout.amount,final_amount:checkout.amount,currency:'GHS',env:'sandbox'}});
  throw new Error(`Unexpected external service: ${String(url)}`);
 });
});
afterEach(()=>{vi.restoreAllMocks();delete runtime.SEEV_ENABLED;delete runtime.SEEV_ENVIRONMENT;delete runtime.SEEV_CHECKOUT_API_KEY;});
it.each(['rsvp','paid'])('rehearses approval → activation → %s admission → scan → host recap on isolated D1',async(mode)=>{
 const owner=await staff('owner'),gate=await staff('gate');const id=crypto.randomUUID(),slug=`rehearsal-${id}`,email=`host-${id}@example.com`,guest=`guest-${id}@example.com`,now=new Date().toISOString();
 const starts=new Date(Date.now()+86400000).toISOString(),ends=new Date(Date.now()+90000000).toISOString();
 await env.DB.prepare(`INSERT INTO party_submissions(id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,venue_map_url,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,event_slug,created_at,updated_at)
 VALUES (?,'Rehearsal host','Rehearsal Host',?,'233000000000','A rehearsal Night','An isolated full event rehearsal','Test Venue','https://maps.google.com/?q=Accra','Accra',?,?,'Night','Test DJ',25,10000,'18+','in_review',?,?,?)`).bind(id,email,starts,ends,slug,now,now).run();
 const review={id,curationNote:'A carefully selected night for our event rehearsal.',tagline:`Your rehearsal ${id.slice(0,8)}`};
 const approved=await curate(req('/api/admin/submissions',{...review,action:'approve'},owner.cookie,'PATCH'));expect(approved.status,await approved.text()).toBe(200);
 const mail=await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE kind='organizer_invitation' AND recipient=?").bind(email).first<{payload:string}>();
 const token=JSON.parse(mail!.payload).text.match(/#token=([^\s]+)/)[1];
 const proof=bytesToBase64Url(new Uint8Array(32).fill(9));
 expect((await activate(req('/api/organizer/activate',{action:'claim',token,password:'RehearsalHost9!',passwordProof:proof,passwordSalt:'AAECAwQFBgcICQoLDA0ODw',passwordIterations:PASSWORD_ITERATIONS}))).status).toBe(200);
 const signedIn=await login(req('/api/admin/session',{email,passwordProof:proof,returnTo:'/organizer/workspace'}));expect(signedIn.status).toBe(200);const hostCookie=signedIn.headers.get('set-cookie')!;
 const dashboard=await workspace(req('/api/organizer/workspace',undefined,hostCookie));const data=await dashboard.json() as {events:Array<{slug:string;status:string}>};expect(data.events).toHaveLength(1);expect(data.events[0]).toMatchObject({slug,status:'unpublished'});
 // Hosts can prepare before the event becomes public.
 const settings=await hostRegistration(req('/api/admin/registrations',{action:'settings',eventSlug:slug,mode,capacity:25,maxPartySize:2,approvalRequired:mode==='rsvp',roomAccess:false,accepting:true,priceMinor:10000},hostCookie));expect(settings.status,await settings.text()).toBe(200);
 expect((await curate(req('/api/admin/submissions',{...review,action:'publish'},owner.cookie,'PATCH'))).status).toBe(200);
 await env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)").bind(gate.id,slug,owner.id,now).run();
 let guestCookie='';
 if(mode==='rsvp') {
  const submitted=await signup(req('/api/registrations',{eventSlug:slug,email:guest,guestName:'Guest Rehearsal',phone:'0240000000',partySize:1,source:'instagram',acceptedTerms:true}));expect(submitted.status,await submitted.text()).toBe(202);
  guestCookie=submitted.headers.get('set-cookie')!;
  const registration=await env.DB.prepare('SELECT id,status FROM event_registrations WHERE event_slug=? AND normalized_email=?').bind(slug,guest).first<{id:string;status:string}>();expect(registration?.status).toBe('requested');
  expect((await hostRegistration(req('/api/admin/registrations',{action:'approve',eventSlug:slug,id:registration!.id},hostCookie))).status).toBe(200);
 } else {
  const response=await initialize(req('/api/payments/initialize',{eventSlug:slug,ticketTierId:'general',quantity:1,fullName:'Paid Rehearsal Guest',email:guest,phone:'0240000000',paymentMethod:'mobile_money',paymentProvider:'seevplus',network:'mtn',acceptedPolicies:true}));expect(response.status,await response.clone().text()).toBe(200);
  const payment=await response.json() as {reference:string};const claim=new URL(checkout.redirect_url).searchParams.get('claim');
  const access=await claimPaid(req('/api/customer/session',{reference:payment.reference,claim}));expect(access.status,await access.clone().text()).toBe(200);guestCookie=access.headers.get('set-cookie')!;
 }
 {
 const walletResponse=await passes(req('/api/customer/tickets',{},guestCookie));expect(walletResponse.status).toBe(200);const wallet=await walletResponse.json() as {orders:Array<{tickets:Array<{qrPayload:string}>}>};const qr=wallet.orders[0].tickets[0].qrPayload;expect(qr).toBeTruthy();
 const entrance=()=>scan(req('/api/admin/check-in',{code:qr,eventSlug:slug,gate:'Main'},gate.cookie));expect((await entrance()).status).toBe(200);expect((await entrance()).status).toBe(409);
 }
 const summary=await readHostSummary(env.DB,slug);expect(summary).toMatchObject({expected:1,checkedIn:1,turnoutPercent:100});expect(summary!.sales.orders).toBe(mode==='paid'?1:0);
 const recapTime=new Date(Date.now()+3*86400000);recapTime.setUTCHours(8,10,0,0);
 await processOrganizerReports(env.DB,recapTime);
 const report=await env.DB.prepare("SELECT r.id,d.payload_json AS payload FROM organizer_reports r JOIN delivery_events d ON d.recovery_grant_id=r.id WHERE r.kind='recap' AND EXISTS (SELECT 1 FROM json_each(r.event_slugs_json) WHERE value=?)").bind(slug).first<{id:string;payload:string}>();
 expect(report).not.toBeNull();expect(JSON.parse(report!.payload).text).toContain('100% turnout');expect(JSON.parse(report!.payload).text).not.toContain(guest);
});
