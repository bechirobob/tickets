import { marketingConsent } from './marketing-audience';

type ProviderContact={id:string;email:string;unsubscribed:boolean};
type Page<T>={data:T[];has_more:boolean};
type Campaign={id:string;event_slug:string;subject:string;html:string;text_body:string;status:string;segment_id:string|null;broadcast_id:string|null;created_at:string};
const now=()=>new Date().toISOString();
class ResendError extends Error { constructor(public status:number){super(status===401||status===403?'Resend needs a key with Contacts and Broadcasts access.':status===429?'Resend is busy or its contact allowance is full. Delivery will retry.':'Resend could not complete the request. Delivery will retry.');} }
export async function resendRequest<T>(env:Cloudflare.Env,path:string,method='GET',body?:unknown):Promise<T> {
 // Keep this worker below the shared team rate; other services can still cause 429s.
 await new Promise(resolve=>setTimeout(resolve,150));
 const response=await fetch(`https://api.resend.com${path}`,{method,headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new ResendError(response.status);
 return response.json() as Promise<T>;
}
async function census(env:Cloudflare.Env) {
 let after='',count=0;
 do {
  const page=await resendRequest<Page<ProviderContact>>(env,`/contacts?limit=100${after?`&after=${encodeURIComponent(after)}`:''}`);
  if(!Array.isArray(page.data)||typeof page.has_more!=='boolean')throw new Error('Resend returned an incomplete contact list.');
  if(page.data.length) await env.DB.prepare(`INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) SELECT lower(json_extract(value,'$.email')),json_extract(value,'$.id'),json_extract(value,'$.unsubscribed'),? FROM json_each(?) WHERE 1 ON CONFLICT(email) DO UPDATE SET provider_id=excluded.provider_id,unsubscribed=excluded.unsubscribed,updated_at=excluded.updated_at`).bind(now(),JSON.stringify(page.data)).run();
  count+=page.data.length;
  if(!page.has_more)break;
  if(!page.data.length)throw new Error('Resend contact pagination could not be completed.');
  if(count>=1000){count=1001;break;}
  after=page.data.at(-1)!.id;
 }while(true);
 await resendRequest(env,'/segments?limit=1');
 await resendRequest(env,'/broadcasts?limit=1');
 await env.DB.prepare("UPDATE marketing_state SET status='ready',contact_count=?,reserved_count=?+(SELECT COUNT(*) FROM marketing_contacts WHERE reserved=1 AND provider_id IS NULL),checked_at=?,error=NULL WHERE id='resend'").bind(count,count,now()).run();
 return count;
}
async function importContacts(env:Cloudflare.Env) {
 let progressed=false;
 const rows=await env.DB.prepare(`SELECT a.email,MAX(a.guest_name) AS name FROM event_audience_contacts a LEFT JOIN marketing_contacts m ON m.email=a.email JOIN curated_event_records e ON e.slug=a.event_slug WHERE ${marketingConsent} AND e.removed_at IS NULL AND e.is_test_event=0 AND m.provider_id IS NULL GROUP BY a.email ORDER BY MIN(a.confirmed_at) LIMIT 4`).all<{email:string;name:string}>();
 for(const row of rows.results){
  let contact:ProviderContact|null=null;
  try{contact=await resendRequest<ProviderContact>(env,`/contacts/${encodeURIComponent(row.email)}`);}catch(error){if(!(error instanceof ResendError)||error.status!==404)throw error;}
  if(!contact){
   const reserved=await env.DB.prepare('SELECT reserved FROM marketing_contacts WHERE email=?').bind(row.email).first<{reserved:number}>();
   if(!reserved?.reserved){
    const capacity=await env.DB.prepare("SELECT MAX(contact_count,reserved_count) AS used FROM marketing_state WHERE id='resend'").first<{used:number}>();
    if(!capacity||capacity.used>=1000)break;
    // The global worker lease serializes imports; reserve before the network call so
    // a crash or ambiguous provider response can never silently spend another slot.
    await env.DB.batch([
     env.DB.prepare('INSERT INTO marketing_contacts(email,reserved,updated_at) VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET reserved=1').bind(row.email,now()),
     env.DB.prepare("UPDATE marketing_state SET reserved_count=MAX(contact_count,reserved_count)+1 WHERE id='resend'")
    ]);
   }
   const created=await resendRequest<{id:string}>(env,'/contacts','POST',{email:row.email,first_name:row.name});
   if(!created.id)throw new Error('Resend did not confirm the new contact.');
   contact={id:created.id,email:row.email,unsubscribed:false};
   await env.DB.prepare("UPDATE marketing_state SET contact_count=contact_count+1 WHERE id='resend'").run();
  }
  progressed=true;
  await env.DB.prepare('INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET provider_id=excluded.provider_id,unsubscribed=excluded.unsubscribed,updated_at=excluded.updated_at').bind(row.email,contact.id,contact.unsubscribed?1:0,now()).run();
 }
 return progressed;
}
async function prepareCampaign(env:Cloudflare.Env,c:Campaign) {
 if(c.status==='sending'||c.status==='review'){
  if(!c.broadcast_id)return;
  const remote=await resendRequest<{status:string;sent_at?:string}>(env,`/broadcasts/${c.broadcast_id}`);
  const accepted=['sent','sending','queued','scheduled'].includes(remote.status);
  await env.DB.prepare('UPDATE marketing_campaigns SET status=?,sent_at=?,error=?,metrics_at=? WHERE id=?').bind(accepted?'sent':'review',remote.sent_at??null,accepted?null:'Delivery was not confirmed. An owner must check this draft in Resend before any retry.',now(),c.id).run();return;
 }
 const event=await env.DB.prepare('SELECT removed_at AS removedAt,status FROM curated_event_records WHERE slug=?').bind(c.event_slug).first<{removedAt:string|null;status:string}>();
 if(!event||event.removedAt||event.status!=='published'){
  await env.DB.prepare("UPDATE marketing_campaigns SET status='cancelled',error='The event is no longer published.' WHERE id=?").bind(c.id).run();return;
 }
 if(!c.segment_id){
  const segments=await resendRequest<Page<{id:string;name:string}>>(env,'/segments?limit=100');
  if(!Array.isArray(segments.data)||segments.has_more)throw new Error('The marketing segment inventory needs owner review.');
  const segment=segments.data.find(s=>s.name===`BeCore ${c.id}`)??await resendRequest<{id:string}>(env,'/segments','POST',{name:`BeCore ${c.id}`});
  if(!segment.id)throw new Error('Resend did not confirm the audience.');
  c.segment_id=segment.id;
  await env.DB.prepare("UPDATE marketing_campaigns SET segment_id=?,status=CASE WHEN status='queued' THEN 'preparing' ELSE status END,error=NULL WHERE id=?").bind(segment.id,c.id).run();
 }
 // Only the immutable, event-scoped snapshot can enter this private campaign segment.
 const rows=await env.DB.prepare(`SELECT r.contact_id AS contactId,a.email,m.provider_id AS providerId,(${marketingConsent}) AS subscribed FROM marketing_recipients r JOIN event_audience_contacts a ON a.id=r.contact_id LEFT JOIN marketing_contacts m ON m.email=a.email WHERE r.campaign_id=? AND r.status='pending' LIMIT 16`).bind(c.id).all<{contactId:string;email:string;providerId:string|null;subscribed:number}>();
 for(const row of rows.results){
  if(row.subscribed&&!row.providerId)continue;
  if(row.subscribed)await resendRequest(env,`/contacts/${encodeURIComponent(row.providerId!)}/segments/${c.segment_id}`,'POST');
  await env.DB.prepare('UPDATE marketing_recipients SET status=? WHERE campaign_id=? AND contact_id=?').bind(row.subscribed?'ready':'skipped',c.id,row.contactId).run();
 }
 if(rows.results.length>=8)return;
 const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM marketing_recipients WHERE campaign_id=? AND status='pending'").bind(c.id).first<{n:number}>();
 if(pending?.n)return;
 // Remove locally revoked consents immediately before handing the broadcast off.
 const revoked=await env.DB.prepare(`SELECT r.contact_id AS id,m.provider_id AS providerId FROM marketing_recipients r LEFT JOIN event_audience_contacts a ON a.id=r.contact_id LEFT JOIN marketing_contacts m ON m.email=a.email WHERE r.campaign_id=? AND r.status='ready' AND (a.id IS NULL OR NOT (${marketingConsent})) LIMIT 4`).bind(c.id).all<{id:string;providerId:string|null}>();
 for(const row of revoked.results){
  if(row.providerId)await resendRequest(env,`/contacts/${row.providerId}/segments/${c.segment_id}`,'DELETE');
  await env.DB.prepare("UPDATE marketing_recipients SET status='skipped' WHERE campaign_id=? AND contact_id=?").bind(c.id,row.id).run();
 }
 if(revoked.results.length)return;
 const ready=await env.DB.prepare("SELECT COUNT(*) AS n FROM marketing_recipients WHERE campaign_id=? AND status='ready'").bind(c.id).first<{n:number}>();
 if(!ready?.n){await env.DB.prepare("UPDATE marketing_campaigns SET status='cancelled',error='No subscribed recipients remain.' WHERE id=?").bind(c.id).run();return;}
 if(!c.broadcast_id){
  const broadcast=await resendRequest<{id:string}>(env,'/broadcasts','POST',{name:`BeCore ${c.id}`,segment_id:c.segment_id,from:'BeCore Tickets <tickets@becoreops.com>',subject:c.subject,html:c.html,text:c.text_body});
  if(!broadcast.id)throw new Error('Resend did not confirm the draft.');
  c.broadcast_id=broadcast.id;
  await env.DB.prepare('UPDATE marketing_campaigns SET broadcast_id=? WHERE id=?').bind(broadcast.id,c.id).run();
 }
 // Compare-and-set is the cancellation boundary. Never retry an ambiguous send.
 const claimed=await env.DB.prepare("UPDATE marketing_campaigns SET status='sending',error=NULL WHERE id=? AND status='preparing' AND EXISTS(SELECT 1 FROM curated_event_records e WHERE e.slug=event_slug AND e.removed_at IS NULL AND e.status='published')").bind(c.id).run();
 if(!claimed.meta.changes)return;
 try{
  await resendRequest(env,`/broadcasts/${c.broadcast_id}/send`,'POST',{});
  await env.DB.prepare("UPDATE marketing_campaigns SET status='sent',sent_at=? WHERE id=?").bind(now(),c.id).run();
 }catch{
  await env.DB.prepare("UPDATE marketing_campaigns SET status='review',error='Delivery was not confirmed. Checking Resend; this announcement will not be sent twice.' WHERE id=?").bind(c.id).run();
 }
}
async function refreshResults(env:Cloudflare.Env) {
 const c=await env.DB.prepare("SELECT id,broadcast_id FROM marketing_campaigns WHERE status='sent' AND broadcast_id IS NOT NULL AND created_at>? AND (metrics_at IS NULL OR metrics_at<?) ORDER BY COALESCE(metrics_at,'') LIMIT 1").bind(new Date(Date.now()-29*86400000).toISOString(),new Date(Date.now()-20*60000).toISOString()).first<{id:string;broadcast_id:string}>();
 if(!c)return;
 const metrics:Record<string,number>={};
 for(const type of ['sent','delivered','bounced','complained']){
  let after='';metrics[type]=0;
  for(let pageNumber=0;pageNumber<11;pageNumber++){
   const page=await resendRequest<Page<{id:string}>>(env,`/broadcasts/${c.broadcast_id}/recipients?type=${type}&limit=100${after?`&after=${encodeURIComponent(after)}`:''}`);
   if(!Array.isArray(page.data)||typeof page.has_more!=='boolean')throw new Error('Delivery results are not available yet.');
   metrics[type]+=page.data.length;
   if(!page.has_more)break;
   if(!page.data.length||pageNumber===10)throw new Error('Delivery results could not be fully counted.');
   after=page.data.at(-1)!.id;
  }
 }
 await env.DB.prepare('UPDATE marketing_campaigns SET metrics_json=?,metrics_at=? WHERE id=?').bind(JSON.stringify(metrics),now(),c.id).run();
}
async function releaseFinishedSegment(env:Cloudflare.Env) {
 const c=await env.DB.prepare("SELECT id,segment_id,broadcast_id,status FROM marketing_campaigns WHERE status IN ('sent','cancelled') AND segment_id IS NOT NULL ORDER BY created_at LIMIT 1").first<{id:string;segment_id:string;broadcast_id:string|null;status:string}>();
 if(!c)return false;
 if(c.broadcast_id){
  const remote=await resendRequest<{status:string}>(env,`/broadcasts/${c.broadcast_id}`);
  // A send acknowledgement is not completion. Keep membership until Resend is done.
  if(remote.status!=='sent'&&!(c.status==='cancelled'&&remote.status==='draft'))return false;
 }
 try{await resendRequest(env,`/segments/${c.segment_id}`,'DELETE');}catch(error){if(!(error instanceof ResendError)||error.status!==404)throw error;}
 await env.DB.prepare('UPDATE marketing_campaigns SET segment_id=NULL WHERE id=?').bind(c.id).run();
 return true;
}
/** A separate cron turn keeps contact imports inside the Workers/D1 free budgets. */
export async function processMarketing(env:Cloudflare.Env) {
 if(!env.RESEND_API_KEY)return;
 const token=crypto.randomUUID(),until=new Date(Date.now()+600000).toISOString();
 const lease=await env.DB.prepare("UPDATE marketing_state SET lease_token=?,lease_until=? WHERE id='resend' AND (lease_until IS NULL OR lease_until<?)").bind(token,until,now()).run();
 if(!lease.meta.changes)return;
 let more=false;
 try{
  const state=await env.DB.prepare("SELECT checked_at AS checkedAt FROM marketing_state WHERE id='resend'").first<{checkedAt:string|null}>();
  if(!state?.checkedAt||Date.now()-Date.parse(state.checkedAt)>5*60000){await census(env);more=true;return;}
  if(await releaseFinishedSegment(env)){more=true;return;}
  const campaign=await env.DB.prepare("SELECT * FROM marketing_campaigns WHERE (status IN ('queued','preparing','sending') OR (status='review' AND (metrics_at IS NULL OR metrics_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes')))) AND scheduled_at<=? ORDER BY CASE WHEN status IN ('sending','review') THEN 0 ELSE 1 END,scheduled_at LIMIT 1").bind(now()).first<Campaign>();
  if(campaign){try{await prepareCampaign(env,campaign);more=Boolean(await env.DB.prepare("SELECT 1 FROM marketing_campaigns WHERE id=? AND status IN ('queued','preparing','sending')").bind(campaign.id).first());}catch(error){await env.DB.prepare('UPDATE marketing_campaigns SET error=? WHERE id=?').bind(error instanceof ResendError?error.message:'Delivery is waiting for Resend. It will retry.',campaign.id).run();throw error;}return;}
  const pending=await env.DB.prepare(`SELECT 1 AS n FROM event_audience_contacts a LEFT JOIN marketing_contacts m ON m.email=a.email JOIN curated_event_records e ON e.slug=a.event_slug WHERE ${marketingConsent} AND e.removed_at IS NULL AND e.is_test_event=0 AND m.provider_id IS NULL AND (COALESCE(m.reserved,0)=1 OR (SELECT MAX(contact_count,reserved_count) FROM marketing_state WHERE id='resend')<1000) LIMIT 1`).first();
  if(pending)more=await importContacts(env);
  else await refreshResults(env);
 }catch(error){
  await env.DB.prepare("UPDATE marketing_state SET status='blocked',error=? WHERE id='resend'").bind(error instanceof ResendError?error.message:'The contact connection needs attention. It will retry automatically.').run();
 }finally{await env.DB.prepare("UPDATE marketing_state SET lease_token=NULL,lease_until=NULL WHERE id='resend' AND lease_token=?").bind(token).run();
  if(more&&env.EMAIL_DELIVERY_QUEUE)await env.EMAIL_DELIVERY_QUEUE.send({deliveryId:'marketing-sync'},{delaySeconds:15});
 }
}
