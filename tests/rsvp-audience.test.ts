import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {adminCookieHeader,createStaffSession} from '../lib/admin-session';
import {requestRegistration,claimRegistration,registrationSettings} from '../lib/registrations';
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
 expect((await retryFailedDeliveries(env)).delivered).toBe(1);
});
it('exports filtered guest emails safely and keeps subscriber count independent of search',async()=>{
 await signup('export@example.com',true);await env.DB.prepare("UPDATE event_registrations SET guest_name='=HYPERLINK(1)' WHERE event_slug=?").bind(slug).run();
 const csv=await audience(get(`/api/admin/audience?eventSlug=${slug}&export=csv`));expect(csv.headers.get('cache-control')).toBe('no-store');expect(await csv.text()).toContain("'=HYPERLINK(1)");
 const empty=await (await audience(get(`/api/admin/audience?eventSlug=${slug}&q=missing`))).json() as {total:number;subscribers:number};expect(empty).toMatchObject({total:0,subscribers:1});
});
