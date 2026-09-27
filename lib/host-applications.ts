import { hashToken } from './admin-session';
import { createSecureToken } from './attendee-auth';
import { emailBrand } from './email-brand';
import { ensureOrganizerAccess } from './organizer-invitations';
import { PASSWORD_ITERATIONS, bytesToBase64Url } from './staff-password-policy';
import { organizerPolicyKeys, policies } from './policies';

export const HOST_ORIGIN = 'https://tickets.becoreops.com';
export type HostInput = { brandName:string; contactName:string; email:string; phone:string; socialUrl:string; about:string };
export type HostApplication = HostInput & {id:string;status:string;emailVerifiedAt:string|null;createdAt:string;reviewNote:string|null;accountId:string|null;hostId:string|null;accessPending:number};
export const applicationColumns = `id,email,brand_name AS brandName,contact_name AS contactName,phone,social_url AS socialUrl,about,status,email_verified_at AS emailVerifiedAt,created_at AS createdAt,review_note AS reviewNote,account_id AS accountId,host_id AS hostId,access_pending AS accessPending`;
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
export function validateHostInput(raw:Record<string,unknown>):HostInput {
 const field=(key:string,label:string,max:number,optional=false)=>{const v=typeof raw[key]==='string'?raw[key].trim():'';if((!optional&&!v)||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v))throw new Error(`Please check ${label}.`);return v;};
 const email=field('email','your email',180).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))throw new Error('Please check your email.');
 const phone=field('phone','your phone number',40);if(!/^\+?[\d\s().-]{7,40}$/u.test(phone)||phone.replace(/\D/g,'').length<7)throw new Error('Please check your phone number.');
 const socialUrl=field('socialUrl','your social page or website',500);let url:URL;
 try{url=new URL(socialUrl);}catch{throw new Error('Add a complete social or website link, starting with https://.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname.includes('.'))throw new Error('Add a public social or website link.');
 if(raw.acceptedPolicies!==true)throw new Error('Accept the host terms before continuing.');
 return {brandName:field('brandName','your host or brand name',120),contactName:field('contactName','your name',120),email,phone,socialUrl:url.toString(),about:field('about','your introduction',600,true)};
}
export async function submitHostApplication(db:D1Database,input:HostInput) {
 const now=new Date().toISOString(),id=crypto.randomUUID(),token=createSecureToken(),hash=await hashToken(token),expires=new Date(Date.now()+48*3600000).toISOString();
 const url=`${HOST_ORIGIN}/organizer/join/confirm#token=${token}`,deliveryId=`host-application/${hash}`;
 const subject='One quick inbox check. Then we meet your brand.';
 const text=`Confirm your BeCore Tickets host application: ${url}\n\nHost: ${input.brandName}\nContact: ${input.contactName}\nSocial page: ${input.socialUrl}\n\nThis link expires in 48 hours. Email confirmation does not grant verified status. BeCore reviews your application next. If you did not apply, ignore this email.`;
 const html=`<div style="max-width:560px;margin:auto;padding:24px;color:#301d2c;background:#faf5ee;font-family:Arial,sans-serif">${emailBrand}<h1>One quick inbox check.</h1><p>Confirm your application for <b>${esc(input.brandName)}</b>.</p><p>Contact: ${esc(input.contactName)}<br>Social page: ${esc(input.socialUrl)}</p><p><a href="${url}" style="display:inline-block;padding:15px 20px;background:#d6f075;color:#301d2c;text-decoration:none;font-weight:bold">Confirm my email</a></p><p>We’ll review your host details next. This link expires in 48 hours.</p><p>Not your application? Ignore this email.</p></div>`;
 // A retry never overwrites a confirmed application or creates another account.
 // Expired/unconfirmed applications can request a fresh link after ten minutes.
 await db.batch([
  db.prepare(`INSERT INTO host_applications(id,email,brand_name,contact_name,phone,social_url,about,verification_hash,verification_expires_at,policy_versions,accepted_at,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET brand_name=excluded.brand_name,contact_name=excluded.contact_name,phone=excluded.phone,social_url=excluded.social_url,about=excluded.about,verification_hash=excluded.verification_hash,verification_expires_at=excluded.verification_expires_at,policy_versions=excluded.policy_versions,accepted_at=excluded.accepted_at,updated_at=excluded.updated_at
   WHERE host_applications.status='awaiting_email' AND host_applications.updated_at<?`)
   .bind(id,input.email,input.brandName,input.contactName,input.phone,input.socialUrl,input.about,hash,expires,JSON.stringify(organizerPolicyKeys.map(key=>({key,version:policies[key].version}))),now,now,now,new Date(Date.now()-600000).toISOString()),
  db.prepare(`INSERT INTO delivery_events(id,recovery_grant_id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at)
   SELECT ?,verification_hash,'host_application_verify',email,'failed',0,?,?,?,? FROM host_applications WHERE email=? AND verification_hash=?`)
   .bind(deliveryId,JSON.stringify({subject,text,html,idempotencyKey:deliveryId}),now,now,now,input.email,hash),
 ]);
}
export async function inspectHostApplication(db:D1Database,token:string) {
 if(!/^[\w-]{43}$/u.test(token))return null;
 return db.prepare(`SELECT brand_name AS brandName,contact_name AS contactName,social_url AS socialUrl FROM host_applications WHERE verification_hash=? AND status='awaiting_email' AND verification_expires_at>?`).bind(await hashToken(token),new Date().toISOString()).first<{brandName:string;contactName:string;socialUrl:string}>();
}
export async function confirmHostApplication(db:D1Database,token:string) {
 if(!/^[\w-]{43}$/u.test(token))throw new Error('This link is invalid, expired or already used.');
 const hash=await hashToken(token),now=new Date().toISOString();
 const results=await db.batch([
  db.prepare(`UPDATE host_applications SET status='pending',email_verified_at=?,updated_at=? WHERE verification_hash=? AND status='awaiting_email' AND verification_expires_at>?`).bind(now,now,hash,now),
  db.prepare(`UPDATE delivery_events SET payload_json=NULL,next_attempt_at=NULL WHERE kind='host_application_verify' AND recovery_grant_id=? AND EXISTS(SELECT 1 FROM host_applications WHERE verification_hash=? AND email_verified_at IS NOT NULL)`).bind(hash,hash),
 ]);
 if(!results[0].meta.changes)throw new Error('This link is invalid, expired or already used.');
}
export async function reviewHostApplication(db:D1Database,id:string,action:'approve'|'reject',actor:string,note:string,existingHostId?:string) {
 const app=await db.prepare(`SELECT ${applicationColumns} FROM host_applications WHERE id=?`).bind(id).first<HostApplication>();
 if(!app||app.status!=='pending'||!app.emailVerifiedAt)throw new Error('Only email-confirmed applications awaiting review can be decided.');
 const account=await db.prepare(`SELECT id,role,status FROM staff_accounts WHERE normalized_email=?`).bind(app.email).first<{id:string;role:string;status:string}>();
 if(action==='approve'&&account&&(account.role!=='organizer'||account.status!=='active'))throw new Error('This email belongs to another staff role or a disabled account. Review People & permissions first.');
 if(action==='approve'&&existingHostId&&!await db.prepare(`SELECT 1 FROM hosts WHERE id=? AND NOT EXISTS(SELECT 1 FROM host_applications WHERE host_id=? AND id<>?)`).bind(existingHostId,existingHostId,id).first())throw new Error('Choose an available host profile.');
 const now=new Date().toISOString(),claim=crypto.randomUUID(),accountId=account?.id??crypto.randomUUID(),hostId=existingHostId??`host:${id}`;
 const selected=`SELECT 1 FROM host_applications WHERE id=? AND review_claim=?`;
 const statements=[db.prepare(`UPDATE host_applications SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,review_claim=?,updated_at=? WHERE id=? AND status='pending' AND email_verified_at IS NOT NULL
 AND (?='reject' OR NOT EXISTS(SELECT 1 FROM staff_accounts WHERE normalized_email=host_applications.email AND (role<>'organizer' OR status<>'active')))`)
 .bind(action==='approve'?'approved':'rejected',note,actor,now,claim,now,id,action)];
 if(action==='approve') {
  statements.push(db.prepare(`INSERT OR IGNORE INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
   SELECT ?,email,contact_name,'organizer',?,?,?,1,'active',?,?,?,? FROM host_applications WHERE id=? AND review_claim=?`)
   .bind(accountId,`pending:${createSecureToken()}`,bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),PASSWORD_ITERATIONS,now,now,actor,now,id,claim));
  if(!existingHostId) statements.push(db.prepare(`INSERT INTO hosts(id,slug,name,bio,city,verification_status,created_at,updated_at) SELECT ?,?,brand_name,'','Accra','verified',?,? FROM host_applications WHERE id=? AND review_claim=?`)
   .bind(hostId,`${app.brandName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'host'}-${id.slice(0,8)}`,now,now,id,claim));
  else statements.push(db.prepare(`UPDATE hosts SET verification_status='verified',updated_at=? WHERE id=? AND EXISTS(${selected})`).bind(now,hostId,id,claim));
  statements.push(db.prepare(`UPDATE host_applications SET account_id=(SELECT id FROM staff_accounts WHERE normalized_email=host_applications.email),host_id=?,access_pending=1 WHERE id=? AND review_claim=?`).bind(hostId,id,claim));
 }
 const decisionMail=action==='reject'
  ? {subject:'An update on your BeCore Tickets host application',text:'Thanks for applying. We couldn’t approve your host application this time. Questions? Reply to tickets@becoreops.com.',html:`<div style="max-width:560px;margin:auto;font-family:Arial,sans-serif">${emailBrand}<h1>An update on your application</h1><p>Thanks for applying. We couldn’t approve your host application this time.</p><p>Questions? <a href="mailto:tickets@becoreops.com">Reply to BeCore Tickets</a>.</p></div>`}
  : {subject:'You’re verified. Your host workspace is ready.',text:`Your host application is approved. Open your workspace: ${HOST_ORIGIN}/organizer/workspace`,html:`<div style="max-width:560px;margin:auto;font-family:Arial,sans-serif">${emailBrand}<h1>You’re verified.</h1><p>Your host application is approved. Your existing login still works.</p><p><a href="${HOST_ORIGIN}/organizer/workspace">Open my workspace</a></p></div>`};
 statements.push(db.prepare(`INSERT INTO delivery_events(id,recovery_grant_id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at)
 SELECT ?,id,'host_application_decision',email,'failed',0,?,?,?,? FROM host_applications WHERE id=? AND review_claim=?
 AND (status='rejected' OR EXISTS(SELECT 1 FROM staff_accounts WHERE id=host_applications.account_id AND must_change_password=0))`)
 .bind(`host-decision/${claim}`,JSON.stringify({...decisionMail,idempotencyKey:`host-decision/${claim}`}),now,now,now,id,claim));
 statements.push(db.prepare(`INSERT INTO operational_audit_events(id,actor_account_id,actor_email,actor_role,action,target_type,target_id,outcome,detail,created_at)
 SELECT ?,?,COALESCE((SELECT normalized_email FROM staff_accounts WHERE id=?),'owner'),'owner',?,'host_application',id,'success',?,? FROM host_applications WHERE id=? AND review_claim=?`)
 .bind(crypto.randomUUID(),actor,actor,`host_application.${action}`,note,now,id,claim));
 const result=await db.batch(statements);if(!result[0].meta.changes)throw new Error('This application changed. Refresh before reviewing.');
}
export async function processPendingHostAccess(db:D1Database) {
 const pending=await db.prepare(`SELECT id,account_id AS accountId,reviewed_by AS actor FROM host_applications WHERE status='approved' AND access_pending=1 ORDER BY reviewed_at LIMIT 20`).all<{id:string;accountId:string;actor:string}>();
 for(const item of pending.results)try{await ensureOrganizerAccess(db,{accountId:item.accountId},item.actor);await db.prepare(`UPDATE host_applications SET access_pending=0 WHERE id=? AND account_id=? AND status='approved'`).bind(item.id,item.accountId).run();}catch{/* Keep pending for retry or owner correction. */}
}
