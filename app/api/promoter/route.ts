import { hashToken,mutationHasValidOrigin,requestMetadata } from '../../../lib/admin-session';
import { privateHeaders } from '../../../lib/organizer-access';
import { promoterReport } from '../../../lib/organizer-promotions';
import { enforceRateLimit } from '../../../lib/security-controls';
export async function POST(request:Request){
  if(!mutationHasValidOrigin(request))return Response.json({error:'Request not accepted.'},{status:403,headers:privateHeaders});
  const {env}=await import('cloudflare:workers');
  if(!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`promoter-report:${await hashToken(requestMetadata(request).ip??'unknown')}`))return Response.json({error:'Give it a minute.'},{status:429,headers:privateHeaders});
  const raw=await request.text();if(raw.length>512)return Response.json({error:'Invalid link.'},{status:400,headers:privateHeaders});
  let b:Record<string,unknown>;try{b=JSON.parse(raw||'{}');if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();}catch{return Response.json({error:'Invalid link.'},{status:400,headers:privateHeaders});}
  if(typeof b.token!=='string'||!/^[A-Za-z0-9_-]{40,128}$/u.test(b.token))return Response.json({error:'Open your private promoter link.'},{status:400,headers:privateHeaders});
  const p=await env.DB.prepare("SELECT id FROM event_promoter_codes WHERE portal_token_hash=? AND portal_expires_at>? AND status='active'").bind(await hashToken(b.token),new Date().toISOString()).first<{id:string}>();
  if(!p)return Response.json({error:'This link expired or was withdrawn. Ask your host for a new one.'},{status:404,headers:privateHeaders});
  const result=await promoterReport(env.DB,p.id);
  // Aggregate totals only: this portal never exposes buyers, contacts or ticket credentials.
  return Response.json(result,{headers:privateHeaders});
}
