export const ATTENDEE_COOKIE_NAME = "bct_attendee";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type AttendeeIdentity = {
  attendeeId: string;
  displayName: string;
  normalizedEmail: string;
  emailVerified: boolean;
};

export type AttendeeRoomAccess = AttendeeIdentity & {
  eventSlug: string;
  ticketId: string;
};

export async function readAttendeeNightAccess(db: D1Database, cookieHeader: string | null, eventSlug: string): Promise<AttendeeRoomAccess | null> {
  const token = readCookie(cookieHeader);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const access = await db.prepare(`
    SELECT p.id AS attendeeId, p.display_name AS displayName, p.normalized_email AS normalizedEmail,
      p.email_verified_at IS NOT NULL AS emailVerified, ticket.event_slug AS eventSlug, ticket.id AS ticketId
    FROM attendee_sessions session JOIN attendee_profiles p ON p.id = session.attendee_id
    JOIN ticket_assignments assignment ON assignment.attendee_id = p.id AND assignment.status = 'active'
    JOIN tickets ticket ON ticket.id = assignment.ticket_id
    JOIN orders orders ON orders.id = ticket.order_id
    WHERE session.token_hash = ? AND session.revoked_at IS NULL AND session.expires_at > ?
      AND p.status = 'active' AND ticket.event_slug = ?
      AND ticket.status IN ('issued', 'checked_in', 'voided', 'refunded')
      AND orders.status IN ('paid', 'refund_pending', 'refunded', 'requires_refund', 'disputed')
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString(), eventSlug).first<AttendeeRoomAccess>();
  return access ? { ...access, emailVerified: Boolean(access.emailVerified) } : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readCookie(cookieHeader: string | null, name = ATTENDEE_COOKIE_NAME): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...value] = part.trim().split("=");
    if (cookieName === name) return value.join("=");
  }
  return null;
}

export function attendeeCookieHeader(token: string): string {
  return `${ATTENDEE_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredAttendeeCookieHeader(): string {
  return `${ATTENDEE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function attendeeSessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
}

export async function readAttendeeIdentity(
  db: D1Database,
  cookieHeader: string | null,
): Promise<AttendeeIdentity | null> {
  const token = readCookie(cookieHeader);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const identity = await db.prepare(`
    SELECT p.id AS attendeeId, p.display_name AS displayName, p.normalized_email AS normalizedEmail,
           p.email_verified_at IS NOT NULL AS emailVerified
    FROM attendee_sessions s
    JOIN attendee_profiles p ON p.id = s.attendee_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND p.status = 'active'
    LIMIT 1
  `).bind(tokenHash, now).first<AttendeeIdentity>();
  if (!identity) return null;
  await db.prepare("UPDATE attendee_sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(now, tokenHash).run();
  return { ...identity, emailVerified: Boolean(identity.emailVerified) };
}

export async function readAttendeeRoomAccess(
  db: D1Database,
  cookieHeader: string | null,
  eventSlug: string,
): Promise<AttendeeRoomAccess | null> {
  const token = readCookie(cookieHeader);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const access = await db.prepare(`
    SELECT p.id AS attendeeId, p.display_name AS displayName, p.normalized_email AS normalizedEmail,
           p.email_verified_at IS NOT NULL AS emailVerified,
           t.event_slug AS eventSlug, t.id AS ticketId
    FROM attendee_sessions s
    JOIN attendee_profiles p ON p.id = s.attendee_id
    JOIN ticket_assignments a ON a.attendee_id = p.id AND a.status = 'active'
    JOIN tickets t ON t.id = a.ticket_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND p.status = 'active'
      AND t.event_slug = ? AND t.status IN ('issued', 'checked_in')
    LIMIT 1
  `).bind(tokenHash, now, eventSlug).first<AttendeeRoomAccess>();
  if (!access) return null;
  await db.prepare("UPDATE attendee_sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(now, tokenHash).run();
  return { ...access, emailVerified: Boolean(access.emailVerified) };
}

export async function listAttendeeEvents(
  db: D1Database,
  attendeeId: string,
): Promise<Array<{ eventSlug: string; ticketCount: number }>> {
  const result = await db.prepare(`
    SELECT t.event_slug AS eventSlug, COUNT(*) AS ticketCount
    FROM ticket_assignments a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.attendee_id = ? AND a.status = 'active' AND t.status IN ('issued', 'checked_in')
    GROUP BY t.event_slug
    ORDER BY MIN(t.issued_at)
  `).bind(attendeeId).all<{ eventSlug: string; ticketCount: number }>();
  return result.results;
}
