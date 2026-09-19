import { createPasswordRecord, hashToken } from "./admin-session";
import { createSecureToken } from "./attendee-auth";
import { emailBrand } from "./email-brand";
import { bytesToBase64Url, PASSWORD_ITERATIONS, type StaffPasswordPayload } from "./staff-password-policy";
import { isRecoveryToken, RECOVERY_ERROR } from "./staff-password-recovery-client";

const approved = "('approved','scheduled','published','unpublished')";
const origin = "https://tickets.becoreops.com";
const eligible = `SELECT 1 FROM staff_accounts a WHERE a.id = organizer_invitations.account_id
  AND a.role = 'organizer' AND a.status = 'active' AND a.must_change_password = 1
  AND a.normalized_email = organizer_invitations.account_email
  AND a.password_hash = organizer_invitations.account_password_hash`;

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function invitationEmail(name: string, url: string) {
  const subject = "You’re on the list. Your host dashboard is ready.";
  const text = `Hi ${name},\n\nYou’re in. Set your password to open your BeCore Tickets host dashboard and keep your events, guest lists and numbers in one place.\n\nSet your password: ${url}\n\nThis private link works once and expires in 48 hours. If it expires, ask BeCore Tickets for a fresh invite.\n\nBeCore Tickets`;
  const html = `<div style="background:#faf5ee;padding:32px 20px;color:#281b2b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:auto">${emailBrand}<h1 style="font-size:30px;line-height:1.15;letter-spacing:-1px">You’re in. Make yourself at home.</h1><p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(name)},</p><p style="font-size:16px;line-height:1.6">Your host dashboard is ready. Set your password to keep your events, guest lists and numbers in one place.</p><p style="margin:30px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#281b2b;color:#faf5ee;text-decoration:none;padding:16px 22px;border-radius:6px;font-weight:700">Set your password</a></p><p style="font-size:14px;line-height:1.6">This private link works once and expires in 48 hours. Keep it to yourself—the guest list is for sharing, this isn’t.</p><p style="font-size:14px;line-height:1.6">Link expired? Ask BeCore Tickets for a fresh invite.</p></div></div>`;
  return { subject, text, html };
}

type Account = { id: string; email: string; name: string; role: string; status: string; mustChange: number; passwordHash: string };
export type InvitationTarget = { submissionId?: string; accountId?: string };

export type OrganizerAccessState = {
  state: "unavailable" | "not_invited" | "blocked" | "activated" | "expired" | "invited";
  canInvite: boolean; expiresAt?: string; createdAt?: string; usedAt?: string | null; deliveryStatus?: string | null;
};

export async function organizerAccessStatus(db: D1Database, target: InvitationTarget): Promise<OrganizerAccessState> {
  const account = target.accountId
    ? await db.prepare("SELECT id, normalized_email AS email, role, status, must_change_password AS mustChange FROM staff_accounts WHERE id=?").bind(target.accountId).first<Account>()
    : await db.prepare(`SELECT a.id, a.normalized_email AS email, a.role, a.status, a.must_change_password AS mustChange
        FROM party_submissions s LEFT JOIN staff_accounts a ON a.normalized_email=lower(trim(s.contact_email)) WHERE s.id=? AND s.status IN ${approved}`)
      .bind(target.submissionId ?? "").first<Account>();
  const available = target.submissionId ? Boolean(await db.prepare(`SELECT 1 FROM party_submissions s WHERE s.id=? AND s.status IN ${approved}
    AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.submission_id=s.id AND e.removed_at IS NOT NULL)`).bind(target.submissionId).first()) : Boolean(account);
  if (!available) return { state: "unavailable", canInvite: false };
  if (!account?.id) return { state: "not_invited", canInvite: true };
  if (account.role !== "organizer" || account.status !== "active") return { state: "blocked", canInvite: false };
  if (!account.mustChange) return { state: "activated", canInvite: false };
  const invite = await db.prepare(`SELECT i.expires_at AS expiresAt, i.created_at AS createdAt, i.used_at AS usedAt,
      d.status AS deliveryStatus FROM organizer_invitations i LEFT JOIN delivery_events d ON d.id='organizer-invitation/'||i.id
      WHERE i.account_id=? AND EXISTS (${eligible.replaceAll("organizer_invitations.", "i.")})`).bind(account.id).first<{ expiresAt: string; createdAt: string; usedAt: string | null; deliveryStatus: string | null }>();
  if (!invite || invite.usedAt) return { state: "not_invited", canInvite: true };
  return { state: invite.expiresAt <= new Date().toISOString() ? "expired" : "invited", canInvite: true, ...invite };
}

/** Account + token + email outbox are committed before any provider call. */
export async function ensureOrganizerAccess(db: D1Database, target: InvitationTarget, actorId: string, resend = false) {
  const now = new Date().toISOString();
  let accountId = target.accountId;
  if (target.submissionId) {
    const submission = await db.prepare(`SELECT contact_email AS email, contact_name AS name FROM party_submissions s
      WHERE s.id=? AND s.status IN ${approved} AND NOT EXISTS
      (SELECT 1 FROM curated_event_records e WHERE e.submission_id=s.id AND e.removed_at IS NOT NULL)`)
      .bind(target.submissionId).first<{ email: string; name: string }>();
    if (!submission) throw new Error("Approve this submission before inviting its organiser.");
    const email = submission.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("The submission needs a valid contact email.");
    // A deliberately unusable password record: only the invitation can set it.
    await db.prepare(`INSERT OR IGNORE INTO staff_accounts
      (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
      SELECT ?,lower(trim(contact_email)),contact_name,'organizer',?, ?, ?,1,'active',?,?,?,?
      FROM party_submissions WHERE id=? AND status IN ${approved}`)
      .bind(crypto.randomUUID(), `pending:${createSecureToken()}`, bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))), PASSWORD_ITERATIONS, now, now, actorId, now, target.submissionId).run();
    accountId = (await db.prepare("SELECT id FROM staff_accounts WHERE normalized_email=?").bind(email).first<{ id: string }>())?.id;
  }
  const account = await db.prepare(`SELECT id, normalized_email AS email, display_name AS name, role, status,
    must_change_password AS mustChange, password_hash AS passwordHash FROM staff_accounts WHERE id=?`).bind(accountId ?? "").first<Account>();
  if (!account || account.role !== "organizer" || account.status !== "active") throw new Error("This email belongs to a disabled account or another staff role. Ask the owner to review access.");

  // Link only the approved event belonging to the verified contact email.
  if (target.submissionId) await db.prepare(`INSERT OR IGNORE INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at)
    SELECT a.id,s.event_slug,?,? FROM party_submissions s JOIN staff_accounts a ON a.normalized_email=lower(trim(s.contact_email))
    WHERE s.id=? AND s.status IN ${approved} AND s.event_slug IS NOT NULL AND a.id=? AND a.role='organizer' AND a.status='active'`)
    .bind(actorId, now, target.submissionId, account.id).run();

  if (account.mustChange) {
    const token = createSecureToken();
    const hash = await hashToken(token);
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const cooldown = new Date(Date.now() - 60_000).toISOString();
    const email = invitationEmail(account.name, `${origin}/organizer/activate#token=${token}`);
    const deliveryId = `organizer-invitation/${id}`;
    const result = await db.batch([
      db.prepare(`INSERT INTO organizer_invitations(account_id,id,token_hash,account_email,account_password_hash,expires_at,created_at)
        SELECT id,?,?,?,?,?,? FROM staff_accounts WHERE id=? AND role='organizer' AND status='active' AND must_change_password=1
          AND normalized_email=? AND password_hash=?
        ON CONFLICT(account_id) DO UPDATE SET id=excluded.id,token_hash=excluded.token_hash,account_email=excluded.account_email,
          account_password_hash=excluded.account_password_hash,expires_at=excluded.expires_at,created_at=excluded.created_at,used_at=NULL,claim_id=NULL
        WHERE ?=1 AND organizer_invitations.created_at<=?`)
        .bind(id,hash,account.email,account.passwordHash,expiresAt,now,account.id,account.email,account.passwordHash,resend ? 1 : 0,cooldown),
      db.prepare(`INSERT INTO delivery_events(id,recovery_grant_id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at)
        SELECT ?,id,'organizer_invitation',account_email,'failed',0,?,?,?,? FROM organizer_invitations WHERE id=? AND EXISTS (${eligible})`)
        .bind(deliveryId,JSON.stringify({ ...email, idempotencyKey: deliveryId }),now,now,now,id),
      db.prepare(`INSERT INTO operational_audit_events(id,actor_account_id,actor_email,actor_role,action,target_type,target_id,outcome,detail,created_at)
        SELECT ?,?,COALESCE((SELECT normalized_email FROM staff_accounts WHERE id=?),'system'),
          COALESCE((SELECT role FROM staff_accounts WHERE id=?),'system'),'organizer.invited','staff_account',account_id,'success','Password setup email queued.',?
          FROM organizer_invitations WHERE id=?`).bind(crypto.randomUUID(),actorId,actorId,actorId,now,id),
    ]);
    if (resend && !result[0].meta.changes) throw new Error("Wait a minute before sending another invite. If they have activated, refresh this page.");
  }
  if (target.submissionId) await db.prepare("UPDATE party_submissions SET organizer_access_pending=0 WHERE id=?").bind(target.submissionId).run();
  return organizerAccessStatus(db, { accountId: account.id });
}

export async function processPendingOrganizerAccess(db: D1Database) {
  const pending = await db.prepare(`SELECT id FROM party_submissions WHERE organizer_access_pending=1 AND status IN ${approved} ORDER BY updated_at LIMIT 20`).all<{ id: string }>();
  for (const item of pending.results) {
    try { await ensureOrganizerAccess(db, { submissionId: item.id }, "approval-automation"); }
    catch { /* Keep pending for operator correction and the next retry. */ }
  }
}

export async function inspectOrganizerInvitation(db: D1Database, token: string) {
  if (!isRecoveryToken(token)) return null;
  return db.prepare(`SELECT expires_at AS expiresAt FROM organizer_invitations
    WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS (${eligible})`)
    .bind(await hashToken(token),new Date().toISOString()).first<{ expiresAt: string }>();
}

export async function claimOrganizerInvitation(db: D1Database, token: string, payload: StaffPasswordPayload) {
  if (!await inspectOrganizerInvitation(db,token)) throw new Error(RECOVERY_ERROR);
  const password = await createPasswordRecord(payload);
  const now = new Date().toISOString();
  const claimId = crypto.randomUUID();
  const claimed = "SELECT account_id FROM organizer_invitations WHERE claim_id=?";
  const result = await db.batch([
    db.prepare(`UPDATE organizer_invitations SET used_at=?,claim_id=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS (${eligible})`).bind(now,claimId,await hashToken(token),now),
    db.prepare(`UPDATE staff_accounts SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,
      failed_login_count=0,locked_until=NULL,password_changed_at=?,updated_at=? WHERE id IN (${claimed})`).bind(password.hash,password.salt,password.iterations,now,now,claimId),
    db.prepare(`UPDATE staff_sessions SET revoked_at=? WHERE revoked_at IS NULL AND account_id IN (${claimed})`).bind(now,claimId),
    db.prepare(`UPDATE staff_auth_challenges SET used_at=? WHERE used_at IS NULL AND account_id IN (${claimed})`).bind(now,claimId),
    db.prepare(`UPDATE delivery_events SET payload_json=NULL,next_attempt_at=NULL WHERE kind='organizer_invitation'
      AND recovery_grant_id IN (SELECT id FROM organizer_invitations WHERE claim_id=?)`).bind(claimId),
    db.prepare(`INSERT INTO operational_audit_events(id,actor_account_id,actor_email,actor_role,action,target_type,target_id,outcome,detail,created_at)
      SELECT ?,id,normalized_email,role,'organizer.activated','staff_account',id,'success','Host chose their password.',? FROM staff_accounts WHERE id IN (${claimed})`).bind(crypto.randomUUID(),now,claimId),
  ]);
  if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) throw new Error(RECOVERY_ERROR);
}
