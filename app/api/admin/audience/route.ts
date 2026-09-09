import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit } from '../../../../lib/admin-session';
const subscriber = "a.consented_at IS NOT NULL AND a.consented_at > COALESCE(a.unsubscribed_at,'')";
async function access(request: Request, slug: string) {
  const { env } = await import('cloudflare:workers'); const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session && (hasPermission(session,'events.manage') || hasPermission(session,'organizer.workspace')) && await hasEventAssignment(env.DB,session,slug) ? session : null };
}
const audience = `WITH guests AS (
  SELECT normalized_email AS email,guest_name AS name,party_size AS guests,kind AS source FROM event_registrations WHERE event_slug=? AND verified_at IS NOT NULL
  UNION ALL SELECT customer_email,COALESCE(customer_name,'Guest'),quantity,'paid' FROM orders WHERE event_slug=? AND payment_provider <> 'rsvp' AND status IN ('paid','refund_pending','refunded','disputed')
), people AS (SELECT LOWER(email) AS email,MAX(name) AS name,SUM(guests) AS guests,GROUP_CONCAT(DISTINCT source) AS source FROM guests GROUP BY LOWER(email))
SELECT p.*,CASE WHEN ${subscriber} THEN 1 ELSE 0 END AS subscribed FROM people p LEFT JOIN event_audience_contacts a ON a.event_slug=? AND a.email=p.email`;
export async function GET(request: Request) {
  const url=new URL(request.url),slug=url.searchParams.get('eventSlug') ?? '',query=(url.searchParams.get('q') ?? '').trim().slice(0,120),offset=Math.max(0,Number.parseInt(url.searchParams.get('offset') ?? '0') || 0);
  const {env,session}=await access(request,slug); if(!session) return Response.json({error:'This event is not assigned to your account.'},{status:403});
  const filter=" WHERE (?='' OR p.email LIKE ? OR p.name LIKE ?)", search=`%${query}%`;
  if(url.searchParams.get('export')==='csv') {
    const rows=await env.DB.prepare(`${audience}${filter} ORDER BY p.email LIMIT 50001`).bind(slug,slug,slug,query,search,search).all<Record<string,unknown>>();
    if(rows.results.length>50000) return Response.json({error:'Narrow the search before exporting this audience.'},{status:400});
    const cell=(value:unknown)=>{let s=String(value ?? '');if(/^[\s]*[=+\-@]/u.test(s))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;};
    await recordAudit(env.DB,{session,action:'audience.exported',targetType:'event',targetId:slug,outcome:'success',detail:`Exported ${rows.results.length} guest emails.`});
    return new Response([['Name','Email','Source','Announcement subscription'],...rows.results.map(r=>[r.name,r.email,r.source,r.subscribed?'Subscribed':'Not subscribed'])].map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${slug}-guests.csv"`,'cache-control':'no-store'}});
  }
  const [rows,total,campaigns,subscribers]=await Promise.all([
    env.DB.prepare(`${audience}${filter} ORDER BY p.email LIMIT 50 OFFSET ?`).bind(slug,slug,slug,query,search,search,offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(subscribed),0) AS subscribers FROM (${audience}${filter})`).bind(slug,slug,slug,query,search,search).first(),
    env.DB.prepare(`SELECT c.id,c.subject,c.status,c.created_at AS createdAt,c.recipient_count AS recipientCount,
      (SELECT COUNT(*) FROM event_announcement_recipients r JOIN delivery_events d ON d.id=r.delivery_id WHERE r.campaign_id=c.id AND d.status IN ('sent','delivered')) AS sent,
      (SELECT COUNT(*) FROM event_announcement_recipients r JOIN delivery_events d ON d.id=r.delivery_id WHERE r.campaign_id=c.id AND d.status IN ('failed','bounced','complained','suppressed')) AS failed
      FROM event_announcement_campaigns c WHERE event_slug=? ORDER BY created_at DESC LIMIT 20`).bind(slug).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM event_audience_contacts a WHERE event_slug=? AND ${subscriber}`).bind(slug).first<{count:number}>(),
  ]);
  return Response.json({contacts:rows.results,...total,subscribers:subscribers?.count ?? 0,campaigns:campaigns.results,emailConfigured:Boolean(env.RESEND_API_KEY&&env.EMAIL_FROM)},{headers:{'cache-control':'no-store'}});
}
export async function POST(request: Request) {
  if(!mutationHasValidOrigin(request))return Response.json({error:'This announcement was not accepted.'},{status:403});
  const body=await request.json().catch(()=>null) as {eventSlug?:string;id?:string;subject?:string;body?:string}|null;
  if(typeof body?.eventSlug!=='string'||typeof body.id!=='string'||!/^[a-f0-9-]{36}$/u.test(body.id)||typeof body.subject!=='string'||body.subject.trim().length<3||body.subject.length>120||typeof body.body!=='string'||body.body.trim().length<10||body.body.length>5000)return Response.json({error:'Add a subject and announcement text.'},{status:400});
  const {env,session}=await access(request,body.eventSlug);if(!session)return Response.json({error:'This event is not assigned to your account.'},{status:403});
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return Response.json({error:'Email delivery needs to be configured before announcements can be sent.'},{status:503});
  const existing=await env.DB.prepare('SELECT id,subject,body,event_slug AS slug FROM event_announcement_campaigns WHERE id=?').bind(body.id).first<{id:string;subject:string;body:string;slug:string}>();
  if(existing)return existing.slug===body.eventSlug&&existing.subject===body.subject.trim()&&existing.body===body.body.trim()?Response.json({queued:true,id:existing.id}):Response.json({error:'This announcement changed. Start a new send.'},{status:409});
  const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM event_audience_contacts a WHERE event_slug=? AND ${subscriber}`).bind(body.eventSlug).first<{count:number}>();
  if(!count?.count)return Response.json({error:'No guests have subscribed to announcements yet.'},{status:409});
  const [created] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO event_announcement_campaigns (id,event_slug,subject,body,created_by,created_at,recipient_count) VALUES (?,?,?,?,?,?,?)").bind(body.id,body.eventSlug,body.subject.trim(),body.body.trim(),session.accountId,new Date().toISOString(),count.count),
    env.DB.prepare(`INSERT OR IGNORE INTO event_announcement_recipients (campaign_id,contact_id) SELECT ?,a.id FROM event_audience_contacts a WHERE a.event_slug=? AND ${subscriber} AND EXISTS (SELECT 1 FROM event_announcement_campaigns c WHERE c.id=? AND c.event_slug=? AND c.subject=? AND c.body=? AND c.created_by=?)`).bind(body.id,body.eventSlug,body.id,body.eventSlug,body.subject.trim(),body.body.trim(),session.accountId),
    env.DB.prepare('UPDATE event_announcement_campaigns SET recipient_count=(SELECT COUNT(*) FROM event_announcement_recipients WHERE campaign_id=?) WHERE id=?').bind(body.id,body.id),
  ]);
  const actual=await env.DB.prepare('SELECT event_slug AS slug,subject,body FROM event_announcement_campaigns WHERE id=?').bind(body.id).first<{slug:string;subject:string;body:string}>();
  if(actual?.slug!==body.eventSlug||actual.subject!==body.subject.trim()||actual.body!==body.body.trim())return Response.json({error:'This announcement changed. Start a new send.'},{status:409});
  if(created.meta.changes) await recordAudit(env.DB,{session,action:'announcements.queued',targetType:'event',targetId:body.eventSlug,outcome:'success',detail:`Queued “${body.subject.trim()}” for ${count.count} subscribed guests.`});
  return Response.json({queued:true,id:body.id,recipients:count.count},{status:202});
}
