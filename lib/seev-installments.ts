import { seevEnvironment, validSeevCheckoutUrl } from './seevplus';
import { requestSeev } from './seev-transport';
import { creditVerifiedInstallment } from './installment-ledger';
import { deliverInstallmentReceipt, recoverInstallmentReceipts } from './installment-receipts';
import { fulfillInstallmentEntitlements } from './installment-entitlements';
const API='https://api.seevplus.com/api/v1/developer/payments';
type Config=Cloudflare.Env;
type Session={id:string;orderId:string;amount:number;currency:string;environment:string;state:string;providerReference:string|null;requestJson:string;checkoutUrl:string|null;createdAt:string};
async function session(db:D1Database,id:string){
 return db.prepare(`SELECT c.id,c.order_id AS orderId,c.amount_minor AS amount,p.currency,p.environment,c.state,
 c.provider_reference AS providerReference,s.request_json AS requestJson,s.checkout_url AS checkoutUrl,s.created_at AS createdAt
 FROM installment_charges c JOIN installment_plans p ON p.order_id=c.order_id JOIN installment_checkout_sessions s ON s.charge_id=c.id WHERE c.id=?`).bind(id).first<Session>();
}
export async function prepareInstallmentCheckout(db:D1Database,input:{chargeId:string;origin:string;returnPath:string}){
 const origin=new URL(input.origin);
 const target=new URL(input.returnPath,origin);
 if(target.origin!==origin.origin || origin.protocol!=='https:' || origin.username || origin.password) throw new Error('Invalid checkout return address.');
 const charge=await db.prepare(`SELECT c.id,c.order_id AS orderId,c.amount_minor AS amount,c.state,p.currency,
 o.customer_name AS name,o.customer_email AS email,o.customer_phone AS phone,o.reference,o.event_slug AS eventSlug
 FROM installment_charges c JOIN installment_plans p ON p.order_id=c.order_id JOIN orders o ON o.id=c.order_id WHERE c.id=?`).bind(input.chargeId)
 .first<{id:string;orderId:string;amount:number;state:string;currency:string;name:string|null;email:string;phone:string;reference:string;eventSlug:string}>();
 if(!charge || charge.state!=='pending'||!charge.name) throw new Error('Payment attempt unavailable.');
 if(!((target.pathname==='/payment/return' && target.searchParams.get('reference')===charge.reference) || target.pathname===`/my-nights/${encodeURIComponent(charge.eventSlug)}`)) throw new Error('Invalid booking return address.');
 const body=JSON.stringify({type:'checkout',amount:charge.amount,currency:charge.currency,channels:['mobile_money'],
 recipient:{name:charge.name,email:charge.email,phone:charge.phone},redirect_url:target.toString(),
 meta:{orderId:charge.orderId,installmentChargeId:charge.id,reference:charge.reference}});
 await db.prepare(`INSERT OR IGNORE INTO installment_checkout_sessions(charge_id,request_json,created_at) VALUES(?,?,?)`).bind(charge.id,body,new Date().toISOString()).run();
}
export async function createInstallmentCheckout(db:D1Database,chargeId:string,config:Config){
 const item=await session(db,chargeId);
 if(!item || item.environment!==seevEnvironment(config)||!config.SEEV_CHECKOUT_API_KEY) throw new Error('Payment environment does not match.');
 if(item.state!=='pending') throw new Error('This payment needs review.');
 const payable=await db.prepare(`SELECT 1 FROM orders o WHERE o.id=? AND o.status IN ('payment_pending','part_paid') AND o.refunded_amount_minor=0
 AND NOT EXISTS(SELECT 1 FROM provider_operation_records r WHERE r.order_id=o.id AND r.kind='refund' AND r.status IN ('pending','completed'))
 AND NOT EXISTS(SELECT 1 FROM payment_disputes d WHERE d.order_id=o.id)`).bind(item.orderId).first();
 if(!payable) throw new Error('This booking needs payment review.');
 if(item.providerReference && validSeevCheckoutUrl(item.checkoutUrl)) return item.checkoutUrl;
 if(Date.now()-Date.parse(item.createdAt)>=24*60*60*1000){
  await db.prepare(`UPDATE installment_charges SET state='review' WHERE id=? AND state='pending'`).bind(chargeId).run();
  throw new Error('This payment needs provider review before another attempt.');
 }
 const response=await requestSeev(API,{method:'POST',headers:{authorization:`Bearer ${config.SEEV_CHECKOUT_API_KEY}`,'content-type':'application/json','idempotency-key':item.id},body:item.requestJson});
 const payload=await response.json() as {success?:boolean;data?:{reference?:unknown;checkout_url?:unknown;amount?:unknown;currency?:unknown;env?:unknown}};
 const data=payload.data;
 if(!response.ok||payload.success!==true||!data||typeof data.reference!=='string'||!/^PAY-[A-Za-z0-9-]{1,160}$/u.test(data.reference)
 ||!validSeevCheckoutUrl(data.checkout_url)||new URL(data.checkout_url).pathname!==`/${data.reference}`||data.amount!==item.amount||data.currency!==item.currency||data.env!==item.environment) throw new Error('Provider response needs verification. Do not start another payment.');
 await db.batch([
  db.prepare(`UPDATE installment_charges SET provider_reference=? WHERE id=? AND (provider_reference IS NULL OR provider_reference=?)`).bind(data.reference,item.id,data.reference),
  db.prepare(`UPDATE installment_checkout_sessions SET checkout_url=?,last_error=NULL WHERE charge_id=? AND EXISTS(SELECT 1 FROM installment_charges WHERE id=? AND provider_reference=?)`).bind(data.checkout_url,item.id,item.id,data.reference),
 ]);
 const saved=await session(db,chargeId);
 if(saved?.providerReference!==data.reference) throw new Error('Conflicting provider reference.');
 return data.checkout_url;
}
export async function verifyInstallmentPayment(db:D1Database,chargeId:string,config:Config){
 const item=await session(db,chargeId);
 if(!item||item.environment!==seevEnvironment(config)) throw new Error('Payment environment does not match.');
 if(!item.providerReference) return {result:'pending' as const};
 const response=await requestSeev(`${API}/${encodeURIComponent(item.providerReference)}`);
 const payload=await response.json() as {success?:boolean;data?:{id?:unknown;reference?:unknown;status?:unknown;amount?:unknown;currency?:unknown;env?:unknown;final_amount?:unknown}};
 const data=payload.data;
 if(!response.ok||payload.success!==true||!data||data.reference!==item.providerReference||data.amount!==item.amount
 ||data.currency!==item.currency||(data.env!==undefined&&data.env!==item.environment)||(data.final_amount!==undefined&&data.final_amount!==item.amount)||typeof data.status!=='string') throw new Error('Provider payment does not match this installment.');
 if(!['completed','success'].includes(data.status)){
  if(item.state==='confirmed') return fulfillInstallmentEntitlements(db,item.orderId);
  // A failure/expiry is not permission to charge again until its terminality is established.
  if(['failed','cancelled','canceled'].includes(data.status)) await db.prepare(`UPDATE installment_charges SET state='review' WHERE id=? AND state='pending'`).bind(item.id).run();
  return {result:'pending' as const};
 }
 await creditVerifiedInstallment(db,{chargeId:item.id,providerReference:item.providerReference,transactionId:typeof data.id==='string'||typeof data.id==='number'?String(data.id):item.providerReference,
 environment:item.environment,currency:item.currency,amountMinor:item.amount});
 const result=await fulfillInstallmentEntitlements(db,item.orderId);
 await deliverInstallmentReceipt(db,item.id);
 return result;
}
export async function recoverInstallmentPayment(env:Config,chargeId:string){
 const item=await session(env.DB,chargeId);
 if(!item||item.environment!==seevEnvironment(env)) return {result:'pending' as const};
 const now=new Date().toISOString();
 const lock=await env.DB.prepare(`UPDATE installment_checkout_sessions SET checked_at=?,lease_until=? WHERE charge_id=? AND (lease_until IS NULL OR lease_until<=?)`)
 .bind(now,new Date(Date.now()+30000).toISOString(),chargeId,now).run();
 if(!lock.meta.changes) return {result:'pending' as const};
 try{
  if(!item.providerReference) return {result:'checkout' as const,authorizationUrl:await createInstallmentCheckout(env.DB,chargeId,env)};
  const result=await verifyInstallmentPayment(env.DB,chargeId,env);
  await env.DB.prepare(`UPDATE installment_checkout_sessions SET last_error=NULL WHERE charge_id=?`).bind(chargeId).run();return result;
 }catch(error){
  await env.DB.prepare(`UPDATE installment_checkout_sessions SET last_error=? WHERE charge_id=?`).bind(error instanceof Error?error.message:'Payment verification unavailable.',chargeId).run();throw error;
 }
}
export async function recoverInstallmentPayments(env:Config,limit=20){
 const rows=await env.DB.prepare(`SELECT c.id FROM installment_charges c JOIN installment_plans p ON p.order_id=c.order_id
 JOIN installment_checkout_sessions s ON s.charge_id=c.id JOIN orders o ON o.id=c.order_id
 WHERE p.environment=? AND (c.state IN ('pending','review') OR (c.state='confirmed' AND (o.status IN ('payment_pending','expired','failed') OR (o.status='part_paid' AND (SELECT COALESCE(SUM(paid.amount_minor),0) FROM installment_charges paid WHERE paid.order_id=o.id AND paid.state='confirmed')>=p.total_minor))))
 AND (s.lease_until IS NULL OR s.lease_until<=?) ORDER BY COALESCE(s.checked_at,'') LIMIT ?`).bind(seevEnvironment(env),new Date().toISOString(),limit).all<{id:string}>();
 let failed=0;
 for(const row of rows.results) try{await recoverInstallmentPayment(env,row.id);}catch{failed++;}
 await recoverInstallmentReceipts(env.DB,limit);
 return {checked:rows.results.length,failed};
}
