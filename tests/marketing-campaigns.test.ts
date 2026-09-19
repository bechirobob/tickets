import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {adminCookieHeader,createStaffSession} from '../lib/admin-session';
import {rememberEventContact} from '../lib/event-audience';
import {processMarketing} from '../lib/marketing-delivery';
import {GET,POST} from '../app/api/admin/campaigns/route';
import {renderAnnouncement} from '../lib/announcement-template';
const origin='https://tickets.becoreops.com';
let slug:string,cookie:string,contacts:Map<string,{id:string;email:string;unsubscribed:boolean}>,remoteStatus:string;
const calls: {path:string;method:string;body:Record<string,unknown>}[]=[];
const request=(body:Record<string,unknown>,auth=cookie)=>new Request(origin+'/api/admin/campaigns',{method:'POST',headers:{origin,cookie:auth,'content-type':'application/json'},body:JSON.stringify({eventSlug:slug,action:'send',id:crypto.randomUUID(),subject:'See you outside',body:'Doors open at eight. <hello> {{{contact.email}}}',template:'reminder',audience:'all',recipients:1,...body})});
async function contact(email='yes@example.com',consent=true,eventSlug=slug){await rememberEventContact(env.DB,{eventSlug,email,guestName:'Guest',source:'rsvp',consentedAt:consent?new Date().toISOString():null});}
async function sync(){await processMarketing(env);await processMarketing(env);}
beforeEach(async()=>{
 await env.DB.batch(['marketing_recipients','marketing_campaigns','marketing_contacts','event_audience_contacts'].map(table=>env.DB.prepare(`DELETE FROM ${table}`)));
 await env.DB.prepare("UPDATE marketing_state SET status='checking',contact_count=0,reserved_count=0,checked_at=NULL,error=NULL,lease_token=NULL,lease_until=NULL").run();
 slug=crypto.randomUUID();const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES(?,?,?,'Email event','Accra venue','Accra',?,?,'Night',0,100,'on_sale','/test.jpg','An event for tests.','published',?,?,?)`).bind(slug,slug,slug,now,now,now,now,now).run();
 const id=crypto.randomUUID();await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,'Host','organizer','test','test',1,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,now,now,now).run();
 await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(id,slug,id,now).run();
 cookie=adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0];contacts=new Map();remoteStatus='draft';calls.length=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const u=new URL(String(url)),method=init?.method??'GET',body=JSON.parse(String(init?.body??'{}'));calls.push({path:u.pathname,method,body});
  if(u.pathname==='/contacts'&&method==='GET')return Response.json({data:[...contacts.values()],has_more:false});
  if(u.pathname==='/contacts'&&method==='POST'){const c={id:crypto.randomUUID(),email:body.email,unsubscribed:false};contacts.set(c.email,c);return Response.json({id:c.id});}
  if(/^\/contacts\/[^/]+$/u.test(u.pathname)){const c=contacts.get(decodeURIComponent(u.pathname.split('/')[2]));return c?Response.json(c):Response.json({},{status:404});}
  if(u.pathname.endsWith('/send')){remoteStatus='sent';return Response.json({id:'broadcast-1'});}
  if(u.pathname.endsWith('/recipients'))return Response.json({data:u.searchParams.get('type')==='delivered'?[{id:'recipient1'}]:[],has_more:false});
  if(u.pathname==='/broadcasts'&&method==='POST')return Response.json({id:'broadcast-1'});
  if(u.pathname==='/broadcasts/broadcast-1')return Response.json({status:remoteStatus});
  return Response.json({id:'segment-1',data:[],has_more:false});
 });
});
afterEach(()=>vi.restoreAllMocks());
it('imports only opted-in addresses and deduplicates across event lists without sending email',async()=>{
 await contact('YES@example.com');await contact('no@example.com',false);await contact('yes@example.com',true,'another-event');
 await sync();
 expect(calls.filter(c=>c.path==='/contacts'&&c.method==='POST')).toHaveLength(1);
 expect(contacts.size).toBe(1);expect(contacts.has('yes@example.com')).toBe(true);
 expect(calls.some(c=>c.path.endsWith('/send')||c.path==='/emails')).toBe(false);
 const summary=await (await GET(new Request(`${origin}/api/admin/campaigns?eventSlug=${slug}`,{headers:{cookie}}))).json();
 expect(summary).toMatchObject({subscribed:1,synced:1,state:{contactCount:1,reservedCount:1}});
});
it('honours the contact cap, keeps RSVP records and reuses existing provider contacts',async()=>{
 await contact();await processMarketing(env);
 await env.DB.prepare('UPDATE marketing_state SET contact_count=1000,reserved_count=1000').run();
 await processMarketing(env);expect(contacts.size).toBe(0);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM event_audience_contacts').first()).toEqual({n:1});
 contacts.set('yes@example.com',{email:'yes@example.com',id:'existing',unsubscribed:false});await env.DB.prepare('UPDATE marketing_state SET checked_at=NULL').run();await processMarketing(env);
 expect(await env.DB.prepare('SELECT provider_id FROM marketing_contacts WHERE email=?').bind('yes@example.com').first()).toEqual({provider_id:'existing'});
 expect(calls.filter(c=>c.path==='/contacts'&&c.method==='POST')).toHaveLength(0);
});
it('never resubscribes a provider-unsubscribed guest',async()=>{
 await contact();contacts.set('yes@example.com',{email:'yes@example.com',id:'existing',unsubscribed:true});await sync();
 expect((await POST(request({action:'preview'}))).status).toBe(200);
 expect(await (await POST(request({action:'preview'}))).json()).toMatchObject({recipients:0});
 expect(calls.some(c=>['POST','PATCH'].includes(c.method))).toBe(false);
});
it('enforces assignment and origin and previews escaped branded content without mutation',async()=>{
 await contact();const unknown=await POST(request({eventSlug:'not-assigned',action:'preview'}));expect(unknown.status).toBe(403);
 expect((await POST(request({action:'preview'},''))).status).toBe(403);
 const wrongOrigin=request({action:'preview'});wrongOrigin.headers.set('origin','https://evil.example');expect((await POST(wrongOrigin)).status).toBe(403);
 const preview=await (await POST(request({action:'preview'}))).json() as {html:string;recipients:number};
 expect(preview.recipients).toBe(1);expect(preview.html).toContain('#281b2b');expect(preview.html).toContain('&lt;hello&gt;');expect(preview.html).not.toContain('{{{contact.email}}}');expect(preview.html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}');
 expect(calls).toHaveLength(0);expect(await env.DB.prepare('SELECT id FROM marketing_campaigns').first()).toBeNull();
});
it('requires synced contacts and an unchanged audience count',async()=>{
 await contact();await processMarketing(env);expect((await POST(request({}))).status).toBe(409);
 await processMarketing(env);expect((await POST(request({recipients:2}))).status).toBe(409);
});
it('snapshots, deduplicates and sends one branded broadcast through marketing, never transactional email',async()=>{
 await contact();await sync();const id=crypto.randomUUID();expect((await POST(request({id}))).status).toBe(202);expect((await POST(request({id}))).status).toBe(200);
 expect((await POST(request({id,body:'Different message entirely'}))).status).toBe(409);
 await contact('later@example.com');await processMarketing(env);await processMarketing(env);
 const send=calls.filter(c=>c.path.endsWith('/send'));expect(send).toHaveLength(1);
 const broadcast=calls.find(c=>c.path==='/broadcasts'&&c.method==='POST');expect(broadcast?.body.from).toBe('BeCore Tickets <tickets@becoreops.com>');expect(broadcast?.body).not.toHaveProperty('send');
 expect(await env.DB.prepare('SELECT recipient_count,status FROM marketing_campaigns WHERE id=?').bind(id).first()).toEqual({recipient_count:1,status:'sent'});
 expect(calls.some(c=>c.path==='/emails')).toBe(false);
});
it('does not send scheduled campaigns early and cancels before dispatch',async()=>{
 await contact();await sync();const id=crypto.randomUUID(),scheduledAt=new Date(Date.now()+86400000).toISOString();
 expect((await POST(request({id,scheduledAt}))).status).toBe(202);await processMarketing(env);
 expect(calls.some(c=>c.path.endsWith('/send'))).toBe(false);
 expect((await POST(request({id,action:'cancel'}))).status).toBe(200);
 await env.DB.prepare("UPDATE marketing_campaigns SET scheduled_at='2020-01-01T00:00:00Z'").run();await processMarketing(env);
 expect(calls.some(c=>c.path.endsWith('/send'))).toBe(false);
});
it('suppresses consent revoked after queuing and leaves admission untouched',async()=>{
 await contact();await sync();expect((await POST(request({}))).status).toBe(202);
 await env.DB.prepare('UPDATE event_audience_contacts SET unsubscribed_at=?').bind(new Date(Date.now()+1000).toISOString()).run();await processMarketing(env);
 expect(calls.some(c=>c.path.endsWith('/send'))).toBe(false);expect(await env.DB.prepare('SELECT status FROM marketing_campaigns').first()).toEqual({status:'cancelled'});
});
it('does not resend after the provider accepts a request but its response is lost',async()=>{
 await contact();await sync();await POST(request({}));const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(url,init)=>{const result=await original(url,init);if(String(url).endsWith('/send'))throw new Error('connection lost');return result;});
 await processMarketing(env);expect(await env.DB.prepare('SELECT status FROM marketing_campaigns').first()).toEqual({status:'review'});
 await env.DB.prepare('UPDATE curated_event_records SET removed_at=? WHERE slug=?').bind(new Date().toISOString(),slug).run();
 await processMarketing(env);expect(await env.DB.prepare('SELECT status FROM marketing_campaigns').first()).toEqual({status:'sent'});
 expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(1);
});
it('reports a sending-only API key as blocked without changing consent or importing anyone',async()=>{
 await contact();vi.mocked(fetch).mockResolvedValue(Response.json({},{status:403}));await processMarketing(env);
 expect(await env.DB.prepare('SELECT status,error FROM marketing_state').first()).toEqual({status:'blocked',error:'Resend needs a key with Contacts and Broadcasts access.'});
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM marketing_contacts').first()).toEqual({n:0});
});
it('serializes competing workers and counts delivery results from provider events',async()=>{
 await contact();await sync();await POST(request({}));await Promise.all([processMarketing(env),processMarketing(env)]);await processMarketing(env);await processMarketing(env);
 expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(1);
 const metrics=await env.DB.prepare('SELECT metrics_json FROM marketing_campaigns').first<{metrics_json:string}>();expect(JSON.parse(metrics!.metrics_json)).toMatchObject({delivered:1,bounced:0});
});
it('uses coming-soon copy without inventing a confirmed date or accepting unsafe images',()=>{
 const rendered=renderAnnouncement({title:'Next event',slug:'next',venue:'Accra',startsAt:'2026-01-01',scheduleStatus:'coming_soon',scheduleLabel:'October · coming soon',imageUrl:'javascript:alert(1)'},'Update','A simple guest update.','update');
 expect(rendered.html).toContain('October · coming soon');expect(rendered.html).not.toContain('January');expect(rendered.html).not.toContain('javascript:');
});
it('selects registration groups without including guests from another event',async()=>{
 const stamp=new Date().toISOString();
 for(const status of ['confirmed','waitlisted','interested','requested']){
  const email=`${status}@example.com`;await contact(email);
  await env.DB.prepare('INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),slug,email,'Guest',status==='interested'?'interest':'rsvp',status,stamp,stamp).run();
 }
 for(const audience of ['confirmed','waitlisted','interested'])expect(await (await POST(request({action:'preview',audience}))).json()).toMatchObject({recipients:1});
 expect(await (await POST(request({action:'preview',audience:'all'}))).json()).toMatchObject({recipients:4});
});
it('prepares a full batch within the free query/subrequest budget and continues through the queue',async()=>{
 for(let i=0;i<20;i++)await contact(`batch${i}@example.com`);
 await processMarketing(env);for(let i=0;i<5;i++)await processMarketing(env);
 expect((await POST(request({recipients:20}))).status).toBe(202);
 const send=vi.fn().mockResolvedValue(undefined),queuedEnv={...env,EMAIL_DELIVERY_QUEUE:{send}} as unknown as Cloudflare.Env;
 const prepare=vi.spyOn(env.DB,'prepare');const before=calls.length;await processMarketing(queuedEnv);
 expect(prepare.mock.calls.length+calls.length-before+1).toBeLessThanOrEqual(50);prepare.mockRestore();
 expect(send).toHaveBeenCalledWith({deliveryId:'marketing-sync'},{delaySeconds:15});
 expect(calls.some(c=>c.path.endsWith('/send'))).toBe(false);
 await processMarketing(env);expect(calls.filter(c=>c.path.endsWith('/send'))).toHaveLength(1);
},15000);
