import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {adminCookieHeader,createStaffSession} from '../lib/admin-session';
import {requestRegistration,claimRegistration,registrationSettings,registrationShareState,cancelRegistration,processRegistrations} from '../lib/registrations';
import {POST as submitRsvp} from '../app/api/registrations/route';
import {rememberEventContact,processEventAnnouncements,notifyRegistrationHosts} from '../lib/event-audience';
import {retryFailedDeliveries,applyDeliveryWebhook} from '../lib/email-delivery';
import {fulfillVerifiedPayment} from '../lib/payment-operations';
import {GET as audience,POST as announce} from '../app/api/admin/audience/route';
import {GET as registrations,POST as configure} from '../app/api/admin/registrations/route';
import {GET as activity,POST as markRead} from '../app/api/admin/organizer-activity/route';
import {POST as unsubscribe} from '../app/api/announcements/unsubscribe/route';
const origin='https://tickets.becoreops.com';
let slug:string,host:string,owner:string,hostId:string;
const post=(path:string,body:unknown,cookie=host)=>new Request(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
const get=(path:string,cookie=host)=>new Request(origin+path,{headers:{cookie}});
async function staff(role:'owner'|'organizer'){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,?,?,'test','test',1,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,role,role,now,now,now).run();
 return {id,cookie:adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0]};
}
async function settings(extra:Record<string,unknown>={}){return configure(post('/api/admin/registrations',{eventSlug:slug,action:'settings',mode:'rsvp',capacity:5,maxPartySize:2,approvalRequired:false,roomAccess:false,...extra}));}
async function signup(email:string,optIn=false){
 await requestRegistration(env.DB,{eventSlug:slug,email,guestName:'Guest <One>',phone:'',partySize:1,announcementsOptIn:optIn},origin);
 const d=await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE kind='registration_access' AND recipient=? ORDER BY created_at DESC LIMIT 1").bind(email).first<{payload:string}>();
 return claimRegistration(env.DB,JSON.parse(d!.payload).text.match(/#token=([^\s]+)/)[1]);
}
async function campaign(extra:Record<string,unknown>={}){return announce(post('/api/admin/audience',{eventSlug:slug,id:crypto.randomUUID(),subject:'Doors update',body:'Doors open at 8. See you there! <hello>',...extra}));}
beforeEach(async()=>{
 await env.DB.batch([env.DB.prepare("DELETE FROM delivery_events WHERE kind IN ('event_announcement','organizer_signup')"),env.DB.prepare('DELETE FROM event_announcement_recipients'),env.DB.prepare('DELETE FROM event_announcement_campaigns'),env.DB.prepare('DELETE FROM event_audience_contacts')]);
 slug=`audience-${crypto.randomUUID()}`;const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES(?,?,?,'Audience event','Venue','Accra',?,?,'Night',10000,10,'on_sale','https://example.com/test.jpg','Complete event details for audience tests.','published',?,?,?)`).bind(slug,slug,slug,new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+90000000).toISOString(),now,now,now).run();
 const h=await staff('organizer');host=h.cookie;hostId=h.id;owner=(await staff('owner')).cookie;
 await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(h.id,slug,h.id,now).run();
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({id:crypto.randomUUID()}));
 expect((await settings()).status).toBe(200);
});
afterEach(()=>vi.restoreAllMocks());
async function directSignup(email:string,extra:Record<string,unknown>={}) {
 return submitRsvp(post('/api/registrations',{eventSlug:slug,email,guestName:'Party Guest',phone:'',partySize:1,acceptedTerms:true,announcementsOptIn:true,...extra},''));
}
it('takes RSVP requests straight to host review and guest emails without sending confirmation or creating an account',async()=>{
 await settings({capacity:100,approvalRequired:true});
 const email='direct-party@example.com';
 const response=await directSignup(email);expect(response.status).toBe(202);expect(response.headers.get('set-cookie')).toBeNull();
 expect(await response.json()).toEqual({message:'RSVP received. Outfit planning starts now.'});
 const reg=await env.DB.prepare('SELECT id,status,attendee_id,verified_at,announcements_opt_in FROM event_registrations WHERE event_slug=? AND normalized_email=?').bind(slug,email).first<{id:string}>();
 expect(reg).toMatchObject({status:'requested',attendee_id:null,verified_at:null,announcements_opt_in:1});
 expect(await env.DB.prepare('SELECT id FROM attendee_profiles WHERE normalized_email=?').bind(email).first()).toBeNull();
 expect(await env.DB.prepare('SELECT id FROM registration_access_grants WHERE registration_id=?').bind(reg!.id).first()).toBeNull();
 expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(email).first()).toBeNull();
 expect(await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&live=1`))).json()).toMatchObject({requested:1,confirmed:0,latest:[{name:'Party Guest',status:'requested'}]});
 expect(await (await audience(get(`/api/admin/audience?eventSlug=${slug}`))).json()).toMatchObject({total:1,subscribers:0,contacts:[{email,subscribed:0}]});
 expect(await (await audience(get(`/api/admin/audience?eventSlug=${slug}&export=csv`))).text()).toContain(email);
 expect((await configure(post('/api/admin/registrations',{eventSlug:slug,action:'approve',id:reg!.id}))).status).toBe(200);
 expect(await env.DB.prepare('SELECT status,attendee_id,verified_at,order_id FROM event_registrations WHERE id=?').bind(reg!.id).first()).toEqual({status:'confirmed',attendee_id:null,verified_at:null,order_id:null});
 await processRegistrations(env,origin);
 expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(email).first()).toBeNull();
 expect((await directSignup(email,{guestName:'Someone else',partySize:2,announcementsOptIn:false})).status).toBe(202);
 expect(await env.DB.prepare('SELECT guest_name,party_size,announcements_opt_in,status FROM event_registrations WHERE id=?').bind(reg!.id).first()).toEqual({guest_name:'Party Guest',party_size:1,announcements_opt_in:1,status:'confirmed'});
});
it('reserves capacity without email verification, waitlists overflow and reuses the reservation after a later verified claim',async()=>{
 await settings({capacity:1,maxPartySize:1});
 await directSignup('first-party@example.com');await directSignup('second-party@example.com');
 const rows=await env.DB.prepare('SELECT id,status,normalized_email AS email FROM event_registrations WHERE event_slug=? ORDER BY created_at,id').bind(slug).all<{id:string;status:string;email:string}>();
 expect(rows.results.map(r=>r.status)).toEqual(['confirmed','waitlisted']);
 await cancelRegistration(env.DB,rows.results[0].id);
 expect(await env.DB.prepare('SELECT status FROM event_registrations WHERE id=?').bind(rows.results[1].id).first()).toEqual({status:'confirmed'});
 // Existing access links remain compatible, but ordinary public signup never sends one.
 const claimed=await signup('second-party@example.com');expect(claimed.registration?.status).toBe('confirmed');
 expect(claimed.registration?.attendeeId).toBeTruthy();
 expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM tickets WHERE order_id=?').bind(claimed.registration!.orderId).first()).toEqual({count:1});
 await settings({capacity:1,maxPartySize:1,accepting:false});expect((await directSignup('closed-party@example.com')).status).toBe(400);
});
it('only advertises links for saved, published and open registration',async()=>{
 const s=(await registrationSettings(env.DB,slug))!;
 expect(registrationShareState(s)).toMatchObject({ready:true,mode:'rsvp'});
 for(const change of [{publication:'unpublished'},{accepting:0},{scheduleStatus:'coming_soon'},{closesAt:'2020-01-01T00:00:00.000Z'}])expect(registrationShareState({...s,...change}).ready).toBe(false);
 expect(registrationShareState({...s,mode:'paid'})).toMatchObject({ready:true,mode:'paid'});
 expect(registrationShareState({...s,mode:'interest',scheduleStatus:'coming_soon'})).toMatchObject({ready:true,mode:'interest'});
 expect(registrationShareState({...s,scheduleStatus:'end_pending',endsAt:''})).toMatchObject({ready:true,mode:'rsvp'});
 expect(registrationShareState({...s,scheduleStatus:'end_pending',startsAt:''}).ready).toBe(false);
 const live=await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&live=1`))).json() as {sharing:{ready:boolean;mode:string}};
 expect(live.sharing).toMatchObject({ready:true,mode:'rsvp'});
});
it('opens 100 approval-only RSVP places with a confirmed start and no known end time',async()=>{
 await env.DB.prepare("UPDATE curated_event_records SET schedule_status='end_pending' WHERE slug=?").bind(slug).run();
 const deadline=new Date(Date.now()+3600000).toISOString();
 expect((await settings({capacity:100,approvalRequired:true,closesAt:deadline})).status).toBe(200);
 const guest=await signup('approval-before-admission@example.com');
 expect(guest.registration?.status).toBe('requested');
 expect(await env.DB.prepare("SELECT id FROM orders WHERE id=?").bind(`rsvp_${guest.registration!.id}`).first()).toBeNull();
 expect((await configure(post('/api/admin/registrations',{eventSlug:slug,action:'approve',id:guest.registration!.id}))).status).toBe(200);
 expect(await env.DB.prepare('SELECT status FROM event_registrations WHERE id=?').bind(guest.registration!.id).first()).toEqual({status:'confirmed'});
 expect(await registrationSettings(env.DB,slug)).toMatchObject({capacity:100,approvalRequired:1,closesAt:deadline});
 await settings({capacity:100,approvalRequired:true,closesAt:'2020-01-01T00:00:00.000Z'});
 await expect(signup('after-cutoff@example.com')).rejects.toThrow('not open');
 await env.DB.prepare("UPDATE curated_event_records SET schedule_status='coming_soon' WHERE slug=?").bind(slug).run();
 expect((await settings({capacity:100})).status).toBe(409);
});
it('stores only verified free emails and preserves explicit subscription choice',async()=>{
 await requestRegistration(env.DB,{eventSlug:slug,email:'unverified@example.com',guestName:'Pending',phone:'',partySize:1,announcementsOptIn:true},origin);
 expect((await (await audience(get(`/api/admin/audience?eventSlug=${slug}`))).json() as {total:number}).total).toBe(0);
 await signup('subscribed@example.com',true);await signup('booking-only@example.com');
 const result=await (await audience(get(`/api/admin/audience?eventSlug=${slug}`))).json() as {total:number;subscribers:number;contacts:{email:string;subscribed:number}[]};
 expect(result).toMatchObject({total:2,subscribers:1});expect(result.contacts.find(c=>c.email==='booking-only@example.com')?.subscribed).toBe(0);
});
it('protects event audiences, live counts and owner activity from other organisers',async()=>{
 const other=(await staff('organizer')).cookie;
 for(const path of [`/api/admin/audience?eventSlug=${slug}`,`/api/admin/registrations?eventSlug=${slug}&live=1`,'/api/admin/organizer-activity'])expect((await (path.includes('audience')?audience(get(path,other)):path.includes('organizer-activity')?activity(get(path,other)):registrations(get(path,other)))).status).toBe(403);
 expect((await announce(post('/api/admin/audience',{eventSlug:slug,id:crypto.randomUUID(),subject:'Update',body:'A private event announcement'},other))).status).toBe(403);
});
it('searches and filters the complete RSVP roster before pagination',async()=>{
 const now=new Date().toISOString();
 await env.DB.batch(Array.from({length:55},(_,i)=>env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at) VALUES(?,?,?,?,1,'rsvp',?,?,?)`).bind(crypto.randomUUID(),slug,`person-${i}@example.com`,`Party Guest ${i}`,i===54?'waitlisted':'requested',now,now)));
 const page=await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&offset=50`))).json() as {total:number;registrations:unknown[]};
 expect(page.total).toBe(55);expect(page.registrations).toHaveLength(5);
 const searched=await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&q=person-54&status=waitlisted`))).json() as {total:number;registrations:{email:string}[]};
 expect(searched).toMatchObject({total:1,registrations:[{email:'person-54@example.com'}]});
 expect((await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&q=person-54&status=requested`))).json() as {total:number}).total).toBe(0);
 expect((await registrations(get(`/api/admin/registrations?eventSlug=${slug}&status=unverified`))).status).toBe(400);
});
it('gives organisers paid pricing, protects existing admissions and reports owner-readable changes',async()=>{
 const response=await settings({mode:'paid',capacity:10,priceMinor:7500});expect(response.status,await response.clone().text()).toBe(200);
 expect(await env.DB.prepare('SELECT price_minor,capacity_admissions FROM event_ticket_tiers WHERE event_slug=?').bind(slug).first()).toEqual({price_minor:7500,capacity_admissions:10});
 expect((await settings({mode:'paid',priceMinor:0})).status).toBe(409);
 const feed=await (await activity(get('/api/admin/organizer-activity',owner))).json() as {unread:number;asOf:string;activity:{detail:string}[]};
 expect(feed.unread).toBeGreaterThan(0);expect(feed.activity.some(a=>a.detail.includes('GHS 75.00'))).toBe(true);
 expect((await markRead(post('/api/admin/organizer-activity',{asOf:feed.asOf},owner))).status).toBe(200);
 expect((await (await activity(get('/api/admin/organizer-activity',owner))).json() as {unread:number}).unread).toBe(0);
});
it('enforces paused registration and deadlines while preserving previously confirmed guests',async()=>{
 await signup('confirmed@example.com');
 expect((await settings({accepting:false})).status).toBe(200);
 await expect(signup('closed@example.com')).rejects.toThrow('not open');
 expect((await settings({mode:'paid',priceMinor:7500})).status).toBe(409);
 expect((await settings({accepting:true,closesAt:'2020-01-01T00:00:00Z'})).status).toBe(200);
 await expect(signup('late@example.com')).rejects.toThrow('not open');
 expect((await registrationSettings(env.DB,slug))?.closesAt).toBe('2020-01-01T00:00:00.000Z');
});
it('updates live signup counts and sends each assigned organiser one alert per verified signup',async()=>{
 const result=await signup('live@example.com');
 const live=await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&live=1`))).json() as {confirmed:number;latest:{name:string}[]};
 expect(live.confirmed).toBe(1);expect(live.latest[0].name).toBe('Guest <One>');
 await notifyRegistrationHosts(env.DB,{eventSlug:slug,sourceId:result.registration!.id,guestName:'Guest <One>',status:'confirmed',guests:1});
 const alerts=await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE kind='organizer_signup' AND recipient=?").bind(`${hostId}@example.com`).all<{payload:string}>();
 expect(alerts.results).toHaveLength(1);expect(JSON.parse(alerts.results[0].payload).html).toContain('&lt;One&gt;');
 await settings({notifyHost:false});await signup('quiet@example.com');
 expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE kind='organizer_signup' AND recipient=?").bind(`${hostId}@example.com`).first<{count:number}>())?.count).toBe(1);
});
it('captures paid emails after verified payment without inventing announcement consent',async()=>{
 await settings({mode:'paid',capacity:10,priceMinor:10000});const now=new Date().toISOString(),id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,unit_quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at) VALUES(?,?,?,'registration',1,1,10000,0,10000,'GHS','paid@example.com','','mobile_money','paystack','payment_pending',?)`).bind(id,id,slug,now).run();
 await env.DB.prepare(`INSERT INTO inventory_reservations(order_id,event_slug,ticket_tier_id,unit_quantity,admission_count,status,expires_at,created_at,updated_at) VALUES(?,?,?,1,1,'held',?,?,?)`).bind(id,slug,`${slug}-registration`,new Date(Date.now()+900000).toISOString(),now,now).run();
 const fulfilled=await fulfillVerifiedPayment(env.DB,{id:1,reference:id,status:'success',amount:10000,currency:'GHS',paidAt:now,channel:'mobile_money',gatewayResponse:'Approved'});expect(fulfilled.result).toBe('paid');
 const data=await (await audience(get(`/api/admin/audience?eventSlug=${slug}`))).json() as {contacts:{email:string;subscribed:number;source:string}[]};
 expect(data.contacts[0]).toMatchObject({email:'paid@example.com',subscribed:0,source:'paid'});
 const live=await (await registrations(get(`/api/admin/registrations?eventSlug=${slug}&live=1`))).json() as {paid:number;confirmed:number};expect(live).toMatchObject({paid:1,confirmed:0});
});
it('queues only subscribers, deduplicates repeated sends and escapes announcement markup',async()=>{
 await signup('yes@example.com',true);await signup('no@example.com');const id=crypto.randomUUID();
 expect((await campaign({id})).status).toBe(202);expect((await campaign({id})).status).toBe(200);expect((await campaign({id,body:'A different announcement'})).status).toBe(409);
 await processEventAnnouncements(env,origin);await processEventAnnouncements(env,origin);
 const emails=await env.DB.prepare("SELECT payload_json AS payload,recipient,provider_id AS provider FROM delivery_events WHERE kind='event_announcement'").all<{payload:string;recipient:string;provider:string}>();
 expect(emails.results).toHaveLength(1);expect(emails.results[0].recipient).toBe('yes@example.com');expect(JSON.parse(emails.results[0].payload).html).toContain('&lt;hello&gt;');
 await applyDeliveryWebhook(env.DB,{providerId:emails.results[0].provider,type:'email.delivered'});
 const result=await (await audience(get(`/api/admin/audience?eventSlug=${slug}`))).json() as {campaigns:{sent:number}[]};expect(result.campaigns[0].sent).toBe(1);
});
it('unsubscribes before queued send without cancelling admission and blocks resubscription by replay',async()=>{
 const registered=await signup('unsub@example.com',true);const queued=await campaign();expect(queued.status).toBe(202);
 const contact=await env.DB.prepare('SELECT unsubscribe_token AS token FROM event_audience_contacts WHERE event_slug=?').bind(slug).first<{token:string}>();
 const form=new FormData();form.set('token',contact!.token);
 expect((await unsubscribe(new Request(origin+'/api/announcements/unsubscribe',{method:'POST',headers:{origin},body:form}))).status).toBe(303);
 await rememberEventContact(env.DB,{eventSlug:slug,email:'unsub@example.com',guestName:'Again',source:'rsvp',consentedAt:'2020-01-01T00:00:00.000Z'});
 await processEventAnnouncements(env,origin);
 expect(await env.DB.prepare("SELECT id FROM delivery_events WHERE kind='event_announcement'").first()).toBeNull();
 expect(await env.DB.prepare('SELECT status FROM event_registrations WHERE id=?').bind(registered.registration!.id).first()).toEqual({status:'confirmed'});
});
it('suppresses failed announcement retries after unsubscribe and recovers abandoned queued delivery',async()=>{
 await signup('retry@example.com',true);await campaign();vi.mocked(fetch).mockResolvedValueOnce(Response.json({message:'Unavailable'},{status:503}));
 await processEventAnnouncements(env,origin);
 await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2020-01-01T00:00:00Z' WHERE kind='event_announcement'").run();
 await env.DB.prepare('UPDATE event_audience_contacts SET unsubscribed_at=? WHERE event_slug=?').bind(new Date(Date.now()+1000).toISOString(),slug).run();
 await retryFailedDeliveries(env);
 expect(await env.DB.prepare("SELECT status FROM delivery_events WHERE kind='event_announcement'").first()).toEqual({status:'suppressed'});
 // A worker can stop between creating a delivery and contacting the provider.
 await env.DB.prepare("UPDATE delivery_events SET status='queued',created_at='2020-01-01T00:00:00Z' WHERE kind='organizer_signup'").run();
 const standard=await retryFailedDeliveries(env,20,'standard');expect(standard.delivered).toBe(0);
 expect(await env.DB.prepare("SELECT status FROM delivery_events WHERE kind='organizer_signup'").first()).toEqual({status:'queued'});
 const prepare=vi.spyOn(env.DB,'prepare');
 await processEventAnnouncements(env,origin);expect(prepare.mock.calls.length).toBeLessThanOrEqual(50);prepare.mockRestore();
 expect(await env.DB.prepare("SELECT status FROM delivery_events WHERE kind='organizer_signup'").first()).toEqual({status:'sent'});
});
it('exports filtered guest emails safely and keeps subscriber count independent of search',async()=>{
 await signup('export@example.com',true);await env.DB.prepare("UPDATE event_registrations SET guest_name='=HYPERLINK(1)' WHERE event_slug=?").bind(slug).run();
 const csv=await audience(get(`/api/admin/audience?eventSlug=${slug}&export=csv`));expect(csv.headers.get('cache-control')).toBe('no-store');expect(await csv.text()).toContain("'=HYPERLINK(1)");
 const empty=await (await audience(get(`/api/admin/audience?eventSlug=${slug}&q=missing`))).json() as {total:number;subscribers:number};expect(empty).toMatchObject({total:0,subscribers:1});
});
it('keeps announcement batches within the free D1 query budget and defers daily quotas',async()=>{
 for(let i=0;i<10;i++)await rememberEventContact(env.DB,{eventSlug:slug,email:`bulk${i}@example.com`,guestName:'Bulk Guest',source:'rsvp',consentedAt:new Date().toISOString()});
 await campaign();const prepare=vi.spyOn(env.DB,'prepare');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({name:'daily_quota_exceeded',message:'Daily email quota reached'},{status:429}));
 await processEventAnnouncements(env,origin);
 expect(prepare.mock.calls.length).toBeLessThanOrEqual(50);prepare.mockRestore();
 const delivered=await env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE kind='event_announcement'").first<{count:number}>();expect(delivered?.count).toBe(8);
 const deferred=await env.DB.prepare("SELECT attempt_count AS attempts,next_attempt_at AS next FROM delivery_events WHERE kind='event_announcement' AND status='failed'").first<{attempts:number;next:string}>();expect(deferred?.attempts).toBe(0);expect(new Date(deferred!.next).getTime()).toBeGreaterThan(Date.now());
 await processEventAnnouncements(env,origin);expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM event_announcement_recipients WHERE status='pending'").first<{count:number}>())?.count).toBe(0);
});
