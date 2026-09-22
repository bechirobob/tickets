import { hasPermission, mutationHasValidOrigin, readAdminSession } from '../../../../lib/admin-session';
import { canReadHostEvent, readHostSummary } from '../../../../lib/host-summary';
const headers={'cache-control':'no-store'};
export async function GET(request:Request) {
  const {env}=await import('cloudflare:workers');
  const session=await readAdminSession(request.headers.get('cookie'),env.DB);
  if(!session||!hasPermission(session,'organizer.workspace'))return Response.json({error:'Sign in to your host workspace.'},{status:403,headers});
  const slug=new URL(request.url).searchParams.get('eventSlug')??'';
  if(!await canReadHostEvent(env.DB,session.accountId,slug,session.role==='owner'))return Response.json({error:'This event is not available to your account.'},{status:403,headers});
  const preference=await env.DB.prepare('SELECT enabled FROM organizer_report_preferences WHERE account_id=?').bind(session.accountId).first<{enabled:number}>();
  const latest=await env.DB.prepare(`SELECT r.created_at AS createdAt,r.kind,d.status FROM organizer_reports r LEFT JOIN delivery_events d ON d.id='organizer-report/'||r.id WHERE r.account_id=? AND r.created_at>=COALESCE((SELECT started_at FROM analytics_baseline WHERE id=1),'1970-01-01') ORDER BY r.created_at DESC LIMIT 1`).bind(session.accountId).first();
  return Response.json({summary:await readHostSummary(env.DB,slug),reports:{enabled:preference?.enabled!==0,canManage:session.role==='organizer',latest}},{headers});
}
export async function PATCH(request:Request) {
  const {env}=await import('cloudflare:workers');
  const session=await readAdminSession(request.headers.get('cookie'),env.DB);
  if(!mutationHasValidOrigin(request)||!session||session.role!=='organizer'||!hasPermission(session,'organizer.workspace'))return Response.json({error:'Sign in to your host workspace.'},{status:403,headers});
  let enabled:boolean;
  try{const raw=await request.text();if(raw.length>256)throw new Error();const body=JSON.parse(raw);if(typeof body.enabled!=='boolean')throw new Error();enabled=body.enabled;}
  catch{return Response.json({error:'Choose whether to receive reports.'},{status:400,headers});}
  const now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO organizer_report_preferences(account_id,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(session.accountId,enabled?1:0,now),
    env.DB.prepare(`UPDATE delivery_events SET status='suppressed',payload_json=NULL,next_attempt_at=NULL,updated_at=? WHERE ?=0 AND kind='organizer_report' AND status IN ('failed','queued') AND recovery_grant_id IN (SELECT id FROM organizer_reports WHERE account_id=?)`).bind(now,enabled?1:0,session.accountId),
  ]);
  return Response.json({enabled},{headers});
}
