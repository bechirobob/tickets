import { canManageInstallmentOrder } from "../../../../lib/installment-access";
import { seevAvailable } from "../../../../lib/seevplus";
import { mutationHasValidOrigin, requestMetadata } from '../../../../lib/admin-session';
import { readAttendeeIdentity, hashToken } from '../../../../lib/attendee-auth';
import { limitRequestBody } from '../../../../lib/request-body';
import { enforceRateLimit } from '../../../../lib/security-controls';
import { readInstallmentBalance,reserveInstallmentCharge } from '../../../../lib/installment-ledger';
import { prepareInstallmentCheckout,createInstallmentCheckout,recoverInstallmentPayment } from '../../../../lib/seev-installments';
const headers={'cache-control':'no-store'};
export async function POST(request:Request) {
 if(!mutationHasValidOrigin(request))return Response.json({error:'Payment request not accepted.'},{status:403,headers});
 const limited=await limitRequestBody(request);if(limited instanceof Response)return limited;request=limited;
 const {env}=await import('cloudflare:workers');
 const identity=await readAttendeeIdentity(env.DB,request.headers.get('cookie'));
 if(!identity)return Response.json({error:'Sign in with your verified booking email to pay the balance.'},{status:401,headers});
 let body:{orderId:string;choice:'installment'|'balance'};
 try {body=await request.json();if(typeof body.orderId!=='string'||body.orderId.length>80||!['installment','balance'].includes(body.choice))throw new Error();}
 catch{return Response.json({error:'Choose a payment option.'},{status:400,headers});}
 const balance=await readInstallmentBalance(env.DB,body.orderId);
 if(!balance||!await canManageInstallmentOrder(env.DB,{orderId:body.orderId,identity,cookieHeader:request.headers.get('cookie')}))return Response.json({error:'Booking not found.'},{status:404,headers});
 const order=await env.DB.prepare(`SELECT o.status,o.event_slug AS eventSlug,e.is_test_event AS isTestEvent FROM orders o JOIN curated_event_records e ON e.slug=o.event_slug
 WHERE o.id=? AND o.refunded_amount_minor=0 AND NOT EXISTS(SELECT 1 FROM payment_disputes d WHERE d.order_id=o.id) AND NOT EXISTS(SELECT 1 FROM provider_operation_records r WHERE r.order_id=o.id AND r.kind='refund' AND r.status IN ('pending','completed')) AND e.removed_at IS NULL AND e.archived_at IS NULL AND e.event_state IN ('on_sale','sold_out','rescheduled') AND e.starts_at>?`).bind(body.orderId,new Date().toISOString()).first<{status:string;eventSlug:string;isTestEvent:number}>();
 if(!order||!['part_paid','payment_pending'].includes(order.status))return Response.json({error:'This booking is not available for another payment.'},{status:409,headers});
 const rate=await enforceRateLimit(env.PAYMENT_RATE_LIMITER,`balance:${await hashToken(identity.normalizedEmail)}`);
 const networkRate=await enforceRateLimit(env.PAYMENT_NETWORK_RATE_LIMITER,`balance-ip:${await hashToken(requestMetadata(request).ip||'unknown')}`);
 if(!rate||!networkRate)return Response.json({error:'Please wait a moment before trying again.'},{status:429,headers});
 const key=request.headers.get('idempotency-key');
 if(!key||!/^[a-f0-9-]{36,80}$/iu.test(key))return Response.json({error:'Invalid payment attempt.'},{status:400,headers});
 const existing=await env.DB.prepare(`SELECT id FROM installment_charges WHERE idempotency_hash=? AND order_id=?`).bind(await hashToken(key),body.orderId).first();
 if(!existing&&!seevAvailable(env,Boolean(order.isTestEvent)))return Response.json({error:'SeevCash payments are temporarily unavailable.'},{status:503,headers});
 try {
  const charge=await reserveInstallmentCharge(env.DB,{orderId:body.orderId,buyerEmail:identity.normalizedEmail,id:crypto.randomUUID(),idempotencyHash:await hashToken(key),requestHash:await hashToken(JSON.stringify([body.orderId,body.choice,identity.attendeeId])),choice:body.choice,checkout:{origin:new URL(request.url).origin,returnPath:`/my-nights/${encodeURIComponent(order.eventSlug)}?payment=1`}});
  if(charge.state==='confirmed')return Response.json({confirmed:true},{headers});
  await prepareInstallmentCheckout(env.DB,{chargeId:charge.id,origin:new URL(request.url).origin,returnPath:`/my-nights/${encodeURIComponent(order.eventSlug)}?payment=1`});
  const authorizationUrl=await createInstallmentCheckout(env.DB,charge.id,env);
  return Response.json({authorizationUrl,amountDueMinor:charge.amountMinor},{headers});
 }catch{return Response.json({error:'Your existing payment is being checked. Do not start another payment yet.'},{status:409,headers});}
}

export async function GET(request:Request) {
 const {env}=await import('cloudflare:workers');
 const identity=await readAttendeeIdentity(env.DB,request.headers.get('cookie'));
 if(!identity)return Response.json({error:'Verified booking email required.'},{status:401,headers});
 const orderId=new URL(request.url).searchParams.get('orderId')??'';
 if(!orderId||orderId.length>80)return Response.json({error:'Booking not found.'},{status:404,headers});
 const balance=await readInstallmentBalance(env.DB,orderId);
 if(!balance||!await canManageInstallmentOrder(env.DB,{orderId,identity,cookieHeader:request.headers.get('cookie')}))return Response.json({error:'Booking not found.'},{status:404,headers});
 const pending=await env.DB.prepare(`SELECT id FROM installment_charges WHERE order_id=? AND state IN ('pending','review') LIMIT 1`).bind(orderId).first<{id:string}>();
 if(pending){try{await recoverInstallmentPayment(env,pending.id);}catch{/* Preserve saved pending charge until provider confirms. */}}
 const current=await readInstallmentBalance(env.DB,orderId);
 return Response.json({balance:current?{collectedMinor:current.collectedMinor,balanceMinor:current.balanceMinor,stepMinor:current.stepMinor}:null,pending:Boolean(await env.DB.prepare(`SELECT 1 AS pending FROM installment_charges WHERE order_id=? AND state IN ('pending','review') LIMIT 1`).bind(orderId).first())},{headers});
}
