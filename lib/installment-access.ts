import {hashToken,readCookie,type AttendeeIdentity} from './attendee-auth';
/** Original verified buyer or the exact session that claimed this checkout.
 * A transferred ticket or merely matching an unverified email never suffices. */
export async function canManageInstallmentOrder(db:D1Database,input:{orderId:string;identity:AttendeeIdentity;cookieHeader:string|null}) {
 const plan=await db.prepare(`SELECT buyer_email AS email FROM installment_plans WHERE order_id=?`).bind(input.orderId).first<{email:string}>();
 if(!plan||plan.email!==input.identity.normalizedEmail)return false;
 if(input.identity.emailVerified)return true;
 const token=readCookie(input.cookieHeader);if(!token)return false;
 return Boolean(await db.prepare(`SELECT 1 AS allowed FROM order_access_grants g JOIN attendee_sessions s ON s.id=g.claimed_session_id
 WHERE g.order_id=? AND g.claimed_at IS NOT NULL AND s.attendee_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`)
 .bind(input.orderId,input.identity.attendeeId,await hashToken(token),new Date().toISOString()).first());
}
