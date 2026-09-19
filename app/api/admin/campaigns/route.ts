import {hasEventAssignment,hasPermission,mutationHasValidOrigin,readAdminSession,recordAudit} from '../../../../lib/admin-session';
import {marketingAudiences,marketingAudienceSql,marketingSummary,type MarketingAudience} from '../../../../lib/marketing-audience';
import {announcementTemplates,renderAnnouncement,type AnnouncementTemplate,type AnnouncementEvent} from '../../../../lib/announcement-template';
async function access(request:Request,slug:string){
 const {env}=await import('cloudflare:workers');const session=await readAdminSession(request.headers.get('cookie'),env.DB);
 return {env,session:session&&(hasPermission(session,'events.manage')||hasPermission(session,'organizer.workspace'))&&await hasEventAssignment(env.DB,session,slug)?session:null};
}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function GET(request:Request){
 const slug=new URL(request.url).searchParams.get('eventSlug')??'',{env,session}=await access(request,slug);
 if(!session)return json({error:'This event is not assigned to your account.'},403);
 const [summary,campaigns,event]=await Promise.all([
  marketingSummary(env.DB,slug),
  env.DB.prepare('SELECT id,subject,status,scheduled_at AS scheduledAt,recipient_count AS recipientCount,created_at AS createdAt,error,metrics_json AS metricsJson,metrics_at AS metricsAt FROM marketing_campaigns WHERE event_slug=? ORDER BY created_at DESC LIMIT 20').bind(slug).all(),
  env.DB.prepare('SELECT title FROM curated_event_records WHERE slug=? AND removed_at IS NULL').bind(slug).first(),
 ]);
 return json({...summary,event,campaigns:campaigns.results.map(c=>({...c,metrics:JSON.parse(String(c.metricsJson))})),configured:Boolean(env.RESEND_API_KEY)});
}
export async function POST(request:Request){
 if(!mutationHasValidOrigin(request))return json({error:'This announcement was not accepted.'},403);
 const input=await request.json().catch(()=>null) as {eventSlug?:string;action?:string;id?:string;subject?:string;body?:string;template?:string;audience?:string;scheduledAt?:string;recipients?:number}|null;
 if(!input||typeof input.eventSlug!=='string')return json({error:'Choose an event.'},400);
 const {env,session}=await access(request,input.eventSlug);
 if(!session)return json({error:'This event is not assigned to your account.'},403);
 if(input.action==='cancel'){
  const result=await env.DB.prepare("UPDATE marketing_campaigns SET status='cancelled' WHERE id=? AND event_slug=? AND status IN ('queued','preparing')").bind(String(input.id),input.eventSlug).run();
  if(!result.meta.changes)return json({error:'Sending has already started, or this announcement was cancelled.'},409);
  await recordAudit(env.DB,{session,action:'announcements.cancelled',targetType:'event',targetId:input.eventSlug,outcome:'success',detail:'Cancelled a queued marketing announcement.'});
  return json({cancelled:true});
 }
 if(!['preview','send'].includes(input.action??'')||typeof input.subject!=='string'||input.subject.trim().length<3||input.subject.length>120||typeof input.body!=='string'||input.body.trim().length<10||input.body.length>5000||!Object.hasOwn(announcementTemplates,input.template??'')||!Object.hasOwn(marketingAudiences,input.audience??''))return json({error:'Choose a template and audience, then add a subject and announcement text.'},400);
 const template=input.template as AnnouncementTemplate,group=input.audience as MarketingAudience;
 const event=await env.DB.prepare('SELECT title,slug,venue,starts_at AS startsAt,schedule_status AS scheduleStatus,schedule_label AS scheduleLabel,image_url AS imageUrl FROM curated_event_records WHERE slug=? AND removed_at IS NULL AND status=\'published\'').bind(input.eventSlug).first<AnnouncementEvent>();
 if(!event)return json({error:'This event is not published.'},409);
 const rendered=renderAnnouncement(event,input.subject.trim(),input.body.trim(),template);
 const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM (${marketingAudienceSql(group)})`).bind(input.eventSlug).first<{count:number}>();
 if(input.action==='preview')return json({...rendered,recipients:count?.count??0});
 if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/u.test(input.id))return json({error:'Preview this announcement before sending.'},400);
 const scheduled=input.scheduledAt?new Date(input.scheduledAt):new Date();
 if(!Number.isFinite(scheduled.getTime()))return json({error:'Choose a valid schedule time.'},400);
 const existing=await env.DB.prepare('SELECT * FROM marketing_campaigns WHERE id=?').bind(input.id).first();
 const same=(c:Record<string,unknown>)=>c.event_slug===input.eventSlug&&c.subject===input.subject!.trim()&&c.body===input.body!.trim()&&c.template===template&&c.audience===group&&(!input.scheduledAt||c.scheduled_at===scheduled.toISOString());
 if(existing)return same(existing)?json({queued:true,id:input.id,status:existing.status}):json({error:'This announcement changed. Preview it again.'},409);
 if(!Number.isFinite(scheduled.getTime())||(input.scheduledAt&&scheduled.getTime()<Date.now()+60000)||scheduled.getTime()>Date.now()+90*86400000)return json({error:'Choose a time from one minute to 90 days ahead.'},400);
 const summary=await marketingSummary(env.DB,input.eventSlug);
 if(!env.RESEND_API_KEY||summary.state?.status!=='ready')return json({error:'The marketing connection is not ready. Your draft is still here.'},503);
 if(!count?.count)return json({error:'No subscribed guests match this audience.'},409);
 if(input.recipients!==count.count)return json({error:'The audience changed. Preview again to confirm the current recipient count.'},409);
 const missing=await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${marketingAudienceSql(group)}) a LEFT JOIN marketing_contacts m ON m.email=a.email WHERE m.provider_id IS NULL`).bind(input.eventSlug).first<{n:number}>();
 if(missing?.n)return json({error:`${missing.n} contact${missing.n===1?' is':'s are'} waiting to sync. Your draft is saved on this screen; try again after the contact count updates.`},409);
 const [created]=await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO marketing_campaigns(id,event_slug,subject,body,template,audience,scheduled_at,created_by,created_at,recipient_count,html,text_body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.id,input.eventSlug,input.subject.trim(),input.body.trim(),template,group,scheduled.toISOString(),session.accountId,new Date().toISOString(),count.count,rendered.html,rendered.text),
  env.DB.prepare(`INSERT OR IGNORE INTO marketing_recipients(campaign_id,contact_id) SELECT ?,a.id FROM (${marketingAudienceSql(group)}) a WHERE EXISTS(SELECT 1 FROM marketing_campaigns c WHERE c.id=? AND c.event_slug=? AND c.subject=? AND c.body=? AND c.template=? AND c.audience=? AND c.created_by=?)`).bind(input.id,input.eventSlug,input.id,input.eventSlug,input.subject.trim(),input.body.trim(),template,group,session.accountId),
  env.DB.prepare('UPDATE marketing_campaigns SET recipient_count=(SELECT COUNT(*) FROM marketing_recipients WHERE campaign_id=?) WHERE id=?').bind(input.id,input.id),
 ]);
 const saved=await env.DB.prepare('SELECT * FROM marketing_campaigns WHERE id=?').bind(input.id).first();
 if(!saved||!same(saved))return json({error:'This announcement changed. Preview it again.'},409);
 if(created.meta.changes)await recordAudit(env.DB,{session,action:'announcements.queued',targetType:'event',targetId:input.eventSlug,outcome:'success',detail:`Queued branded ${template} announcement for ${saved.recipient_count} subscribed contacts.`});
 if(created.meta.changes&&env.EMAIL_DELIVERY_QUEUE&&!input.scheduledAt){try{await env.EMAIL_DELIVERY_QUEUE.send({deliveryId:'marketing-sync'});}catch{/* The cron recovers committed campaigns if queue delivery is unavailable. */}}
 return json({queued:true,id:input.id,recipients:saved.recipient_count},202);
}
