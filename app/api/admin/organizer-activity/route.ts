import { mutationHasValidOrigin,readAdminSession } from '../../../../lib/admin-session';
async function access(request:Request){const {env}=await import('cloudflare:workers');const session=await readAdminSession(request.headers.get('cookie'),env.DB);return {env,session:session?.role==='owner'?session:null};}
export async function GET(request:Request){
  const {env,session}=await access(request);if(!session)return Response.json({error:'Owner access is required.'},{status:403});
  const asOf=new Date().toISOString();
  const [events,unread]=await Promise.all([
    env.DB.prepare(`SELECT a.id,a.actor_email AS actor,a.action,a.target_id AS eventSlug,e.title AS eventTitle,a.detail,a.created_at AS createdAt
      FROM operational_audit_events a LEFT JOIN curated_event_records e ON e.slug=a.target_id
      WHERE a.actor_role='organizer' AND a.outcome='success' ORDER BY a.created_at DESC,a.id DESC LIMIT 50`).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM operational_audit_events WHERE actor_role='organizer' AND outcome='success'
      AND created_at > COALESCE((SELECT seen_at FROM owner_activity_reads WHERE account_id=?),'')`).bind(session.accountId).first<{count:number}>(),
  ]);
  return Response.json({activity:events.results,unread:unread?.count ?? 0,asOf},{headers:{'cache-control':'no-store'}});
}
export async function POST(request:Request){
  const {env,session}=await access(request);if(!session||!mutationHasValidOrigin(request))return Response.json({error:'Owner access is required.'},{status:403});
  const body=await request.json().catch(()=>null) as {asOf?:string}|null;
  if(typeof body?.asOf!=='string'||!Number.isFinite(Date.parse(body.asOf))||Date.parse(body.asOf)>Date.now())return Response.json({error:'Refresh the activity feed.'},{status:400});
  await env.DB.prepare('INSERT INTO owner_activity_reads (account_id,seen_at) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET seen_at=MAX(owner_activity_reads.seen_at,excluded.seen_at)').bind(session.accountId,new Date(body.asOf).toISOString()).run();
  return Response.json({saved:true});
}
