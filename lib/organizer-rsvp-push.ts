import { generateRequestDetails } from 'web-push-neo';
import { validPushEndpoint } from './push-subscription';
import { hostEventEnded } from './analytics-period';

type AlertKind = 'rsvp' | 'purchase';
const sources = {
  rsvp: {table:'organizer_rsvp_push_deliveries',source:'event_registrations',column:'registration_id',eligible:"r.kind='rsvp' AND r.status IN ('requested','waitlisted','confirmed')",title:'New RSVP',body:'Open your guest list to see the latest RSVP.',view:'rsvp&tab=roster'},
  purchase: {table:'organizer_purchase_push_deliveries',source:'orders',column:'order_id',eligible:"r.status='paid' AND r.total_amount_minor>0 AND r.payment_verified_at IS NOT NULL",title:'Tickets purchased',body:'A ticket purchase is confirmed. Open your guest list.',view:'guests'},
} as const;

// Only the two internal wrappers choose these SQL identifiers; no request data
// can select a table, query condition or notification destination.
async function deliverOrganizerPush(env: Cloudflare.Env, id: string, kind: AlertKind) {
  const config=sources[kind],now=new Date().toISOString(),claim=crypto.randomUUID();
  const acquired=await env.DB.prepare(`UPDATE ${config.table} SET claim=?,lease_until=?,attempts=attempts+1
    WHERE id=? AND completed_at IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(claim,new Date(Date.now()+120000).toISOString(),id,now).run();
  if(!acquired.meta.changes)return;
  const finish=(outcome:string)=>env.DB.prepare(`UPDATE ${config.table} SET completed_at=?,outcome=?,claim=NULL,lease_until=NULL WHERE id=? AND claim=?`).bind(new Date().toISOString(),outcome,id,claim).run();
  const eligible=async()=>{
   const row=await env.DB.prepare(`SELECT p.id AS subscriptionId,p.endpoint,p.p256dh,p.auth,p.consent_id AS subscriptionVersion,r.event_slug AS slug,e.title,e.schedule_status AS scheduleStatus,e.event_state AS eventState,e.ends_at AS endsAt,d.created_at AS createdAt,d.attempts
    FROM ${config.table} d JOIN organizer_push_subscriptions p ON p.id=d.subscription_id AND p.account_id=d.account_id AND p.consent_id=d.subscription_version
    JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=s.id
    JOIN ${config.source} r ON r.id=d.${config.column} JOIN curated_event_records e ON e.slug=r.event_slug
    JOIN staff_event_assignments a ON a.account_id=s.id AND a.event_slug=r.event_slug
    WHERE d.id=? AND d.claim=? AND d.completed_at IS NULL AND d.lease_until>? AND p.revoked_at IS NULL AND ss.revoked_at IS NULL AND ss.expires_at>? AND s.status='active' AND s.role='organizer' AND s.must_change_password=0
    AND e.removed_at IS NULL AND e.status='published' AND e.event_state NOT IN ('cancelled','postponed') AND ${config.eligible}`)
    .bind(id,claim,new Date().toISOString(),new Date().toISOString()).first<{subscriptionId:string;subscriptionVersion:string;endpoint:string;p256dh:string;auth:string;slug:string;title:string;scheduleStatus:string;eventState:string;endsAt:string;createdAt:string;attempts:number}>();
   return row&&!hostEventEnded(row,Date.now())?row:null;
  };
  const row=await eligible();
  if(!row||Date.parse(row.createdAt)+86400000<=Date.now()){await finish('ineligible');return;}
  if(!validPushEndpoint(row.endpoint)){await finish('invalid_endpoint');return;}
  let accepted=false;
  try{
    if(!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT))throw new Error('Push unavailable');
    const details=await generateRequestDetails({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({
      kind:`organizer_${kind}`,title:`${config.title} · ${row.title}`.slice(0,120),body:config.body,
      url:`/organizer/workspace?area=events&event=${encodeURIComponent(row.slug)}&view=${config.view}`,tag:`host-${kind}-${id}`,
    }),{vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY},TTL:86400,urgency:'high',topic:id.slice(0,32),signal:AbortSignal.timeout(7000)});
    if(!await eligible()){await finish('ineligible');return;}
    const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(7000)});
    if(response.status===404||response.status===410){await env.DB.prepare('UPDATE organizer_push_subscriptions SET revoked_at=?,updated_at=? WHERE id=? AND consent_id=?').bind(now,now,row.subscriptionId,row.subscriptionVersion).run();await finish('expired');return;}
    if(!response.ok)throw new Error('Push rejected');accepted=true;
  }catch{/* Persistent claims recover without exposing device keys. */}
  if(accepted)await finish('accepted');else if(row.attempts>=3)await finish('failed');
}
export const deliverOrganizerRsvpPush=(env:Cloudflare.Env,id:string)=>deliverOrganizerPush(env,id,'rsvp');
export const deliverOrganizerPurchasePush=(env:Cloudflare.Env,id:string)=>deliverOrganizerPush(env,id,'purchase');

async function retryOrganizerPush(env:Cloudflare.Env,kind:AlertKind){
 const config=sources[kind],now=new Date().toISOString();
 await env.DB.prepare(`UPDATE ${config.table} SET completed_at=?,outcome='expired' WHERE completed_at IS NULL AND (lease_until IS NULL OR lease_until<=?) AND (attempts>=3 OR created_at<=?)`).bind(now,now,new Date(Date.now()-86400000).toISOString()).run();
 const rows=await env.DB.prepare(`SELECT id FROM ${config.table} WHERE completed_at IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at LIMIT 50`).bind(now).all<{id:string}>();
 for(const row of rows.results){if(env.EMAIL_DELIVERY_QUEUE)await env.EMAIL_DELIVERY_QUEUE.send({deliveryId:`organizer-${kind}:${row.id}`});else if(env.ENVIRONMENT!=='production')await deliverOrganizerPush(env,row.id,kind);else throw new Error('Host notification queue is unavailable');}
}
export const retryOrganizerRsvpPush=(env:Cloudflare.Env)=>retryOrganizerPush(env,'rsvp');
export const retryOrganizerPurchasePush=(env:Cloudflare.Env)=>retryOrganizerPush(env,'purchase');
async function enqueueOrganizerPush(db:D1Database,queue:Cloudflare.Env['EMAIL_DELIVERY_QUEUE'],sourceId:string,kind:AlertKind){
 if(!queue)return;const config=sources[kind];
 const rows=await db.prepare(`SELECT id FROM ${config.table} WHERE ${config.column}=? AND completed_at IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at LIMIT 50`).bind(sourceId,new Date().toISOString()).all<{id:string}>();
 if(rows.results.length)await queue.sendBatch(rows.results.map(row=>({body:{deliveryId:`organizer-${kind}:${row.id}`}})));
}
export const enqueueOrganizerRsvpPush=(db:D1Database,queue:Cloudflare.Env['EMAIL_DELIVERY_QUEUE'],id:string)=>enqueueOrganizerPush(db,queue,id,'rsvp');
export const enqueueOrganizerPurchasePush=(db:D1Database,queue:Cloudflare.Env['EMAIL_DELIVERY_QUEUE'],id:string)=>enqueueOrganizerPush(db,queue,id,'purchase');

/** Must immediately follow the verified order UPDATE in the same D1 batch.
 * changes() binds capture to the first successful paid transition, so duplicate
 * callbacks and later device opt-ins cannot backfill historical purchases. */
export function captureOrganizerPurchasePush(db:D1Database,orderId:string,now:string){
 return db.prepare(`INSERT OR IGNORE INTO organizer_purchase_push_deliveries(id,order_id,subscription_id,account_id,subscription_version)
 SELECT lower(hex(randomblob(16))),o.id,p.id,p.account_id,p.consent_id FROM orders o
 JOIN organizer_push_subscriptions p JOIN staff_event_assignments a ON a.account_id=p.account_id AND a.event_slug=o.event_slug
 JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id
 JOIN curated_event_records e ON e.slug=o.event_slug
 WHERE changes()=1 AND o.id=? AND o.status='paid' AND o.payment_verified_at IS NOT NULL AND o.total_amount_minor>0
 AND p.revoked_at IS NULL AND s.role='organizer' AND s.status='active' AND s.must_change_password=0 AND ss.revoked_at IS NULL AND ss.expires_at>?
 AND e.removed_at IS NULL AND e.status='published' AND e.event_state NOT IN ('cancelled','postponed')`).bind(orderId,now);
}
