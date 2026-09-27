import {hashToken,mutationHasValidOrigin,requestMetadata} from '../../../../lib/admin-session';
import {enforceRateLimit} from '../../../../lib/security-controls';
import {confirmHostApplication,inspectHostApplication} from '../../../../lib/host-applications';
export async function POST(request:Request){
 if(!mutationHasValidOrigin(request))return Response.json({error:'This request was not accepted.'},{status:403});
 const raw=await request.text();if(raw.length>512)return Response.json({error:'This request is too large.'},{status:413});
 let data:{action?:string;token?:string};try{data=JSON.parse(raw);if(!data||typeof data.token!=='string'||!['inspect','confirm'].includes(data.action??''))throw new Error();}catch{return Response.json({error:'This link is invalid, expired or already used.'},{status:400});}
 const {env}=await import('cloudflare:workers');
 if(!await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER,`host-confirm:${await hashToken(requestMetadata(request).ip??'anonymous')}`))return Response.json({error:'Wait a minute and try again.'},{status:429});
 try{if(data.action==='inspect'){const application=await inspectHostApplication(env.DB,data.token!);if(!application)throw new Error();return Response.json({application},{headers:{'cache-control':'no-store'}});}await confirmHostApplication(env.DB,data.token!);return Response.json({confirmed:true},{headers:{'cache-control':'no-store'}});}catch{return Response.json({error:'This link is invalid, expired or already used. Return to the application form for a fresh link.'},{status:400});}
}
