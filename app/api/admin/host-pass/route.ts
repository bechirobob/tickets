import { hasPermission, readAdminSession, mutationHasValidOrigin, recordAudit, hashToken, requestMetadata } from '../../../../lib/admin-session';
import { hostPassScope, hostPassStatus, provisionHostPass, sendHostPass } from '../../../../lib/event-host-pass';
import { limitRequestBody } from '../../../../lib/request-body';
import { enforceRateLimit } from '../../../../lib/security-controls';
const headers={'cache-control':'no-store, private'};
async function authorize(request:Request) {
 const {env}=await import('cloudflare:workers');
 const session=await readAdminSession(request.headers.get('cookie'),env.DB);
 if(!session || session.role!=='owner' || !hasPermission(session,'accounts.manage'))return {env,session:null};
 const valid=await env.DB.prepare(`SELECT 1 FROM staff_sessions ss JOIN staff_accounts s ON s.id=ss.account_id
  WHERE ss.id=? AND s.status='active' AND s.role='owner' AND (s.mfa_required=0 OR ss.mfa_verified_at IS NOT NULL)`).bind(session.sessionId).first();
 return {env,session:valid?session:null};
}
export async function GET(request:Request) {
 const {env,session}=await authorize(request);
 if(!session)return Response.json({error:'Owner access is required.'},{status:403,headers});
 try {
  const scope=hostPassScope(env),query=new URL(request.url).searchParams;
  if(query.get('accountId')!==scope.accountId)return Response.json({available:false},{headers});
  const email=query.get('email')??'';
  return Response.json({available:true,...await hostPassStatus(env,email)},{headers});
 } catch {return Response.json({available:false},{headers});}
}
export async function POST(request:Request) {
 const bounded=await limitRequestBody(request,1024);if(bounded instanceof Response)return bounded;request=bounded;
 if(!mutationHasValidOrigin(request))return Response.json({error:'This request was not accepted.'},{status:403,headers});
 const {env,session}=await authorize(request);
 if(!session)return Response.json({error:'Owner access is required.'},{status:403,headers});
 const input=await request.json().catch(()=>null) as {accountId?:unknown;email?:unknown;eventSlug?:unknown;action?:unknown;confirm?:unknown}|null;
 try {
  const scope=hostPassScope(env);
  if(!input || input.accountId!==scope.accountId || input.eventSlug!==scope.eventSlug || typeof input.email!=='string' || input.email.length>254 || !['provision','send'].includes(String(input.action)))throw new Error();
  if(input.action==='send' && input.confirm!=='private-single-use-guest-login')throw new Error();
  if(!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`host-pass:${await hashToken(session.accountId+(requestMetadata(request).ip??''))}`))return Response.json({error:'Wait a minute before trying again.'},{status:429,headers});
  const result=input.action==='provision'?await provisionHostPass(env,input.email,session.accountId):await sendHostPass(env,input.email);
  await recordAudit(env.DB,{session,action:`event_host_pass.${input.action}`,targetType:'event',targetId:scope.eventSlug,outcome:'success',detail:`One event-only complimentary Host admission. Reused: ${result.invitation?.reused===true}. Invitation state: ${result.invitation?.state}. No staff permissions changed.`});
  return Response.json({available:true,...result},{headers});
 }catch{return Response.json({error:'The Host pass action was not completed. Refresh its status before another attempt.'},{status:409,headers});}
}
