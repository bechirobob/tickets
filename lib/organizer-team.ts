import { createPasswordRecord, hashToken, type AdminSession } from './admin-session';
import { bytesToBase64Url,PASSWORD_ITERATIONS,type StaffPasswordPayload } from './staff-password-policy';
import { createSecureToken } from './attendee-auth';
import { emailInput, OrganizerError, requireOrganizerEvent, textInput } from './organizer-access';
import { emailBrand } from './email-brand';

const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function readTeam(db:D1Database,session:AdminSession,slug:string){
  const event=await requireOrganizerEvent(db,session,slug);
  const members=await db.prepare(`SELECT a.id,a.display_name AS name,a.normalized_email AS email,a.role,a.status FROM staff_event_assignments s JOIN staff_accounts a ON a.id=s.account_id WHERE s.event_slug=? AND a.role IN ('organizer','gate') ORDER BY a.display_name`).bind(slug).all();
  const invites=await db.prepare(`SELECT i.id,i.account_email AS email,i.role,i.created_at AS createdAt,i.expires_at AS expiresAt,i.used_at AS usedAt,i.revoked_at AS revokedAt,(julianday(i.expires_at)<julianday('now')) AS expired,
    (SELECT status FROM delivery_events d WHERE d.id='team-invitation/'||i.id) AS deliveryStatus FROM organizer_team_invites i WHERE event_slug=? ORDER BY created_at DESC LIMIT 100`).bind(slug).all();
  return {members:members.results,invites:invites.results,canManage:session.role==='owner'||Boolean(event.isLead)};
}
export async function inviteTeam(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const event=await requireOrganizerEvent(db,session,b.eventSlug,true),email=emailInput(b.email),name=textInput(b.name,'team member name',100);
  const role=b.role;if(role!=='organizer'&&role!=='gate')throw new OrganizerError('Choose co-host or door staff.');
  if(email===session.email)throw new OrganizerError('You already have access to this Night.');
  const now=new Date().toISOString();
  const recent=await db.prepare("SELECT 1 FROM organizer_team_invites WHERE event_slug=? AND account_email=? AND revoked_at IS NULL AND julianday(created_at)>julianday('now','-1 minute')").bind(event.slug,email).first();
  if(recent)throw new OrganizerError('An invitation was just queued. Wait a minute before trying again.',429);
  const accountId=crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,?,?,?,?,?,1,'active',?,?,?,?)`).bind(accountId,email,name,role,`pending:${createSecureToken()}`,bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),PASSWORD_ITERATIONS,now,now,session.accountId,now).run();
  const account=await db.prepare('SELECT id,role,status FROM staff_accounts WHERE normalized_email=?').bind(email).first<{id:string;role:string;status:string}>();
  if(!account||account.role!==role||account.status!=='active')throw new OrganizerError('This person has another staff role or their account is disabled. Ask BeCore to review their access.',409);
  if(await db.prepare('SELECT 1 FROM staff_event_assignments WHERE account_id=? AND event_slug=?').bind(account.id,event.slug).first())throw new OrganizerError('This person already belongs to the event team.',409);
  const token=createSecureToken(),id=crypto.randomUUID(),expiresAt=new Date(Date.now()+48*3600000).toISOString();
  const url=`https://tickets.becoreops.com/organizer/team/accept#token=${token}`;
  const subject=`You’re invited to the team for ${event.title}`;
  const text=`Hi ${name},\n\n${session.actor} invited you to help with ${event.title} as ${role==='gate'?'door staff':'a co-host'}.\n\nReview and accept: ${url}\n\nThis private link expires in 48 hours. If you were not expecting it, ignore it.`;
  const html=`<div style="font-family:system-ui;max-width:560px;margin:auto">${emailBrand}<h1>Your crew is calling.</h1><p>Hi ${escape(name)},</p><p>${escape(session.actor)} invited you to ${escape(event.title)} as ${role==='gate'?'door staff':'a co-host'}.</p><p><a href="${escape(url)}">Review and accept the invitation</a></p><p>This private link expires in 48 hours.</p></div>`;
  await db.batch([
    db.prepare('UPDATE organizer_team_invites SET revoked_at=? WHERE event_slug=? AND account_email=? AND used_at IS NULL AND revoked_at IS NULL').bind(now,event.slug,email),
    db.prepare('INSERT INTO organizer_team_invites(id,event_slug,account_id,account_email,role,token_hash,invited_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,event.slug,account.id,email,role,await hashToken(token),session.accountId,now,expiresAt),
    db.prepare("INSERT INTO delivery_events(id,recovery_grant_id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at) VALUES (?,?,'team_invitation',?,'failed',0,?,?,?,?)").bind(`team-invitation/${id}`,id,email,JSON.stringify({subject,text,html,idempotencyKey:`team-invitation/${id}`}),now,now,now),
  ]);
  return {id,queued:true};
}
// Lead access is rechecked at acceptance and again before delayed email delivery.
export const validTeamInvite=`i.revoked_at IS NULL AND i.used_at IS NULL AND i.expires_at>? AND a.status='active' AND a.role=i.role AND a.normalized_email=i.account_email
  AND e.removed_at IS NULL AND EXISTS (SELECT 1 FROM staff_accounts lead WHERE lead.id=i.invited_by AND lead.status='active' AND
    (lead.role='owner' OR (lead.role='organizer' AND EXISTS (SELECT 1 FROM staff_event_assignments current_access WHERE current_access.event_slug=e.slug AND current_access.account_id=lead.id) AND (e.organizer_owner_id=lead.id OR EXISTS (SELECT 1 FROM party_submissions s WHERE s.id=e.submission_id AND lower(trim(s.contact_email))=lead.normalized_email AND EXISTS (SELECT 1 FROM staff_event_assignments assignment WHERE assignment.event_slug=e.slug AND assignment.account_id=lead.id))))))`;
export async function inspectTeamInvite(db:D1Database,token:string){
  if(!/^[A-Za-z0-9_-]{40,128}$/u.test(token))return null;
  return db.prepare(`SELECT i.id,i.account_id AS accountId,i.account_email AS email,i.role,i.event_slug AS eventSlug,e.title AS eventTitle,a.must_change_password AS needsPassword
    FROM organizer_team_invites i JOIN staff_accounts a ON a.id=i.account_id JOIN curated_event_records e ON e.slug=i.event_slug
    WHERE i.token_hash=? AND ${validTeamInvite}`).bind(await hashToken(token),new Date().toISOString()).first<{id:string;accountId:string;email:string;role:string;eventSlug:string;eventTitle:string;needsPassword:number}>();
}
export async function acceptTeamInvite(db:D1Database,token:string,payload:StaffPasswordPayload){
  const invite=await inspectTeamInvite(db,token);if(!invite)throw new OrganizerError('This invitation expired or was withdrawn. Ask the lead host for a fresh one.');
  const password=invite.needsPassword?await createPasswordRecord(payload):null,now=new Date().toISOString(),claim=crypto.randomUUID();
  const result=await db.batch([
    db.prepare(`UPDATE organizer_team_invites SET used_at=?,claim_id=? WHERE id IN (SELECT i.id FROM organizer_team_invites i JOIN staff_accounts a ON a.id=i.account_id JOIN curated_event_records e ON e.slug=i.event_slug
      WHERE i.id=? AND a.must_change_password=? AND ${validTeamInvite})`).bind(now,claim,invite.id,invite.needsPassword,now),
    password?db.prepare(`UPDATE staff_accounts SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,password_changed_at=?,updated_at=?
      WHERE id=(SELECT account_id FROM organizer_team_invites WHERE claim_id=?) AND must_change_password=1`).bind(password.hash,password.salt,password.iterations,now,now,claim):db.prepare('SELECT 1'),
    db.prepare(`INSERT OR IGNORE INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) SELECT account_id,event_slug,invited_by,? FROM organizer_team_invites WHERE claim_id=?`).bind(now,claim),
    db.prepare(`UPDATE staff_sessions SET revoked_at=? WHERE account_id=(SELECT account_id FROM organizer_team_invites WHERE claim_id=?) AND ?=1`).bind(now,claim,invite.needsPassword),
    db.prepare(`UPDATE staff_auth_challenges SET used_at=? WHERE account_id=(SELECT account_id FROM organizer_team_invites WHERE claim_id=?) AND ?=1 AND used_at IS NULL`).bind(now,claim,invite.needsPassword),
    db.prepare(`INSERT INTO operational_audit_events(id,actor_account_id,actor_email,actor_role,action,target_type,target_id,outcome,detail,created_at)
      SELECT ?,account_id,account_email,role,'organizer.team_accepted','event',event_slug,'success','Invitation accepted.',? FROM organizer_team_invites WHERE claim_id=?`).bind(crypto.randomUUID(),now,claim),
    db.prepare(`UPDATE delivery_events SET payload_json=NULL,next_attempt_at=NULL WHERE id IN (SELECT 'team-invitation/'||id FROM organizer_team_invites WHERE claim_id=?)`).bind(claim),
  ]);
  if(result[0].meta.changes!==1)throw new OrganizerError('This invitation changed. Open the latest invite and try again.',409);
  return {accepted:true,role:invite.role};
}
export async function revokeTeam(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,b.eventSlug,true),id=textInput(b.id,'team member',120),now=new Date().toISOString();
  if(b.action==='team_revoke_invite'){
    await db.prepare('UPDATE organizer_team_invites SET revoked_at=? WHERE id=? AND event_slug=?').bind(now,id,e.slug).run();return {revoked:true};
  }
  if(id===session.accountId)throw new OrganizerError('You cannot remove your own access here.');
  const lead=await db.prepare(`SELECT 1 FROM curated_event_records e JOIN staff_accounts a ON a.id=? WHERE e.slug=? AND
    (a.role='owner' OR e.organizer_owner_id=a.id OR EXISTS (SELECT 1 FROM party_submissions s WHERE s.id=e.submission_id AND lower(trim(s.contact_email))=a.normalized_email))`).bind(id,e.slug).first();
  if(lead)throw new OrganizerError('The lead host cannot be removed here.');
  await db.batch([
    db.prepare(`DELETE FROM staff_event_assignments WHERE account_id=? AND event_slug=? AND EXISTS (SELECT 1 FROM staff_accounts a WHERE a.id=staff_event_assignments.account_id AND a.role IN ('organizer','gate'))`).bind(id,e.slug),
    db.prepare('UPDATE organizer_team_invites SET revoked_at=? WHERE account_id=? AND event_slug=? AND revoked_at IS NULL').bind(now,id,e.slug),
  ]);
  return {removed:true};
}
