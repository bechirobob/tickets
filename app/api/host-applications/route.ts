import { limitRequestBody } from '../../../lib/request-body';
import {hashToken,mutationHasValidOrigin,requestMetadata} from '../../../lib/admin-session';
import {enforceRateLimit} from '../../../lib/security-controls';
import {submitHostApplication,validateHostInput} from '../../../lib/host-applications';
import {retryFailedDeliveries} from '../../../lib/email-delivery';
export async function POST(request:Request){
  const bounded = await limitRequestBody(request, 6000);
  if (bounded instanceof Response) return bounded;
  request = bounded;

 if(!mutationHasValidOrigin(request))return Response.json({error:'This request was not accepted.'},{status:403});
 const raw=await request.text();if(raw.length>6000)return Response.json({error:'This application is too large.'},{status:413});
 let input;
 try { const data=JSON.parse(raw);if(!data||typeof data!=='object')throw new Error('Check your application.');if(data.website)return Response.json({received:true},{status:202});input=validateHostInput(data); }
 catch(error){return Response.json({error:error instanceof Error?error.message:'Check your application.'},{status:400});}
 const {env}=await import('cloudflare:workers');
 const meta=requestMetadata(request);
 const allowed=await Promise.all([enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER,`host-ip:${await hashToken(meta.ip??'anonymous')}`),enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER,`host-email:${await hashToken(input.email)}`)]);
 if(allowed.some(x=>!x))return Response.json({error:'A few too many attempts. Give it a minute and try again.'},{status:429});
 try{await submitHostApplication(env.DB,input);}catch{return Response.json({error:'Couldn’t save your details. They’re still here—please try again.'},{status:503});}
 // Persistence determines success; provider failure leaves the durable outbox for retry.
 try{await retryFailedDeliveries(env,5,'host_applications');}catch{}
 return Response.json({received:true},{status:202,headers:{'cache-control':'no-store'}});
}
