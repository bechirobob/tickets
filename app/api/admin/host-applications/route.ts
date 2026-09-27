import {hasPermission,mutationHasValidOrigin,readAdminSession} from '../../../../lib/admin-session';
import {applicationColumns,processPendingHostAccess,reviewHostApplication} from '../../../../lib/host-applications';
import {retryFailedDeliveries} from '../../../../lib/email-delivery';
async function owner(request:Request){const {env}=await import('cloudflare:workers');const session=await readAdminSession(request.headers.get('cookie'),env.DB);return {env,session:session&&hasPermission(session,'accounts.manage')?session:null};}
export async function GET(request:Request){
 const {env,session}=await owner(request);if(!session)return Response.json({error:'Owner access is required.'},{status:403});
 const params=new URL(request.url).searchParams,status=params.get('status')??'pending',page=Math.min(10000,Math.max(0,Number(params.get('page'))||0));
 if(!['pending','awaiting_email','approved','rejected'].includes(status)||!Number.isInteger(page))return Response.json({error:'Choose a valid queue.'},{status:400});
 const [items,counts,hosts]=await Promise.all([env.DB.prepare(`SELECT ${applicationColumns} FROM host_applications WHERE status=? ORDER BY created_at DESC LIMIT 20 OFFSET ?`).bind(status,page*20).all(),env.DB.prepare('SELECT status,COUNT(*) AS count FROM host_applications GROUP BY status').all(),env.DB.prepare('SELECT id,name,slug FROM hosts WHERE NOT EXISTS(SELECT 1 FROM host_applications a WHERE a.host_id=hosts.id) ORDER BY name LIMIT 500').all()]);
 return Response.json({items:items.results,counts:counts.results,hosts:hosts.results},{headers:{'cache-control':'no-store'}});
}
export async function PATCH(request:Request){
 const {env,session}=await owner(request);if(!session)return Response.json({error:'Owner access is required.'},{status:403});
 if(!mutationHasValidOrigin(request))return Response.json({error:'This request was not accepted.'},{status:403});
 const raw=await request.text();if(raw.length>2000)return Response.json({error:'This request is too large.'},{status:413});
 let data:{id:string;action:'approve'|'reject';note?:string;hostId?:string};
 try{data=JSON.parse(raw);if(!data||typeof data.id!=='string'||data.id.length>128||!['approve','reject'].includes(data.action)||(data.note!==undefined&&(typeof data.note!=='string'||data.note.length>600))||(data.hostId!==undefined&&(typeof data.hostId!=='string'||data.hostId.length>128)))throw new Error();}catch{return Response.json({error:'Check the review details.'},{status:400});}
 try{await reviewHostApplication(env.DB,data.id,data.action,session.accountId,data.note?.trim()??'',data.hostId||undefined);}catch(error){const message=error instanceof Error?error.message:'';return Response.json({error:/^(Only email|This email|Choose an available|This application)/.test(message)?message:'The review could not be saved. Refresh and try again.'},{status:409});}
 if(data.action==='approve'){try{await processPendingHostAccess(env.DB);await retryFailedDeliveries(env,5,'invitations');}catch{}}
 try{await retryFailedDeliveries(env,5,'host_applications');}catch{}
 return Response.json({saved:true},{headers:{'cache-control':'no-store'}});
}
