import { createSecureToken, hashToken } from "./attendee-auth";

export const PLATFORM_ANNOUNCEMENT_CONSENT_VERSION = "becore-tickets-announcements-v1";
export const PLATFORM_ANNOUNCEMENT_CONSENT_TEXT = "Keep me posted on new nights from BeCore Tickets.";

export type PlatformAnnouncementStatus = "not_subscribed" | "pending" | "subscribed" | "unsubscribed";
export type PlatformAnnouncementPreference = {
  platformAnnouncementsOptIn: boolean;
  status: PlatformAnnouncementStatus;
  revision: number;
};

// Eligibility needs both the recorded verified action and a still-active,
// verified profile. Merely typing an existing member's email is never proof.
export const platformAnnouncementEligible = `s.status = 'subscribed' AND s.verified_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM attendee_profiles p WHERE p.normalized_email = s.email
    AND p.email_verified_at IS NOT NULL AND p.status = 'active')
  AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email = s.email AND m.unsubscribed = 1)`;

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("A valid email is required.");
  return email;
}

type PlatformAnnouncementChoice = {
  email: string;
  source: "rsvp" | "checkout";
  sourceId: string;
  optedIn: boolean;
  // The caller must establish a CURRENT authenticated, verified identity whose
  // email matches input.email. A profile lookup or booking claim is insufficient.
  verifiedEmail?: boolean;
};

/** Append to the source creation batch so consent cannot interrupt a booking. */
export function preparePlatformAnnouncementChoice(db: D1Database, input: PlatformAnnouncementChoice): D1PreparedStatement[] {
  const email = normalizedEmail(input.email);
  if (!input.sourceId || input.sourceId.length > 200) throw new Error("A submission reference is required.");
  const now = new Date().toISOString();
  const optedIn = input.optedIn === true;
  const verified = input.verifiedEmail === true;
  const sourceExists = input.source === "rsvp"
    ? "EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND normalized_email = ? AND kind = 'rsvp')"
    : "EXISTS (SELECT 1 FROM orders WHERE id = ? AND LOWER(TRIM(customer_email)) = ? AND payment_provider <> 'rsvp')";
  return [
    db.prepare(`INSERT INTO platform_announcement_choices
      (id, email, source, source_id, opted_in, verified_email, consent_version, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${sourceExists} ON CONFLICT(source, source_id) DO NOTHING`)
      .bind(crypto.randomUUID(), email, input.source, input.sourceId, optedIn ? 1 : 0, verified ? 1 : 0, PLATFORM_ANNOUNCEMENT_CONSENT_VERSION, now, input.sourceId, email),
    db.prepare(`INSERT INTO platform_announcement_subscriptions
      (email, status, consent_version, consented_at, verified_at, source, source_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND ? = 1
      ON CONFLICT(email) DO UPDATE SET
        status = excluded.status, consent_version = excluded.consent_version,
        consented_at = excluded.consented_at, verified_at = excluded.verified_at,
        source = excluded.source, source_id = excluded.source_id,
        revision = platform_announcement_subscriptions.revision + 1, updated_at = excluded.updated_at
      WHERE platform_announcement_subscriptions.status = 'pending' AND excluded.status = 'subscribed'`)
      .bind(email, verified ? "subscribed" : "pending", PLATFORM_ANNOUNCEMENT_CONSENT_VERSION, now, verified ? now : null,
        input.source, input.sourceId, now, now, optedIn ? 1 : 0),
  ];
}

/** For callers whose matching source record already exists. */
export async function recordPlatformAnnouncementChoice(db: D1Database, input: PlatformAnnouncementChoice): Promise<void> {
  await db.batch(preparePlatformAnnouncementChoice(db, input));
}

type VerificationGrantType = "recovery" | "registration";

function grantRecord(grantType: VerificationGrantType) {
  return grantType === "recovery"
    ? { from: "attendee_recovery_grants g", email: "g.normalized_email", unclaimed: "g.used_at IS NULL AND g.claimed_session_id IS NULL" }
    : { from: "(SELECT grants.*, r.normalized_email FROM registration_access_grants grants JOIN event_registrations r ON r.id = grants.registration_id) g", email: "g.normalized_email", unclaimed: "g.claimed_session_id IS NULL" };
}

/** Bind only a matching booking's checked line or an explicit verification request. */
export async function bindPlatformAnnouncementVerification(db: D1Database, input: {
  email: string; grantType: VerificationGrantType; grantId: string; sourceId?: string; explicitPreference?: true;
}): Promise<boolean> {
  if (!input.sourceId && input.explicitPreference !== true) return false;
  const email = normalizedEmail(input.email), now = new Date().toISOString();
  const grant = grantRecord(input.grantType);
  const source = input.grantType === "recovery" ? "checkout" : "rsvp";
  const matchingSource = input.grantType === "recovery"
    ? "EXISTS (SELECT 1 FROM orders o WHERE o.id = c.source_id AND LOWER(TRIM(o.customer_email)) = s.email AND o.payment_provider <> 'rsvp')"
    : "g.registration_id = c.source_id";
  const result = await db.prepare(`INSERT INTO platform_announcement_verifications
    (grant_type, grant_id, email, subscription_revision, source, source_id, created_at)
    SELECT ?, g.id, s.email, s.revision, s.source, s.source_id, ?
    FROM platform_announcement_subscriptions s JOIN ${grant.from} ON ${grant.email} = s.email
    WHERE s.email = ? AND s.status = 'pending' AND g.id = ? AND ${grant.unclaimed} AND g.expires_at > ? AND g.created_at >= s.consented_at
      AND (? = 1 OR EXISTS (SELECT 1 FROM platform_announcement_choices c
        WHERE c.email = s.email AND c.source = ? AND c.source_id = ? AND c.opted_in = 1
          AND c.source = s.source AND c.source_id = s.source_id AND ${matchingSource}))
    ON CONFLICT(grant_type, grant_id) DO NOTHING`)
    .bind(input.grantType, now, email, input.grantId, now, input.explicitPreference === true ? 1 : 0, source, input.sourceId ?? "").run();
  return result.meta.changes === 1;
}

/** Token preview for the existing claim screen; never changes consent. */
export async function readPlatformAnnouncementVerification(db: D1Database, input: {
  grantType: VerificationGrantType; token: string;
}): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(input.token)) return false;
  const grant = grantRecord(input.grantType);
  return Boolean(await db.prepare(`SELECT 1 FROM platform_announcement_verifications v
    JOIN platform_announcement_subscriptions s ON s.email = v.email AND s.revision = v.subscription_revision AND s.status = 'pending'
    JOIN ${grant.from} ON g.id = v.grant_id AND ${grant.email} = v.email
    WHERE v.grant_type = ? AND v.consumed_at IS NULL AND g.token_hash = ? AND ${grant.unclaimed} AND g.expires_at > ?`)
    .bind(input.grantType, await hashToken(input.token), new Date().toISOString()).first());
}

/** Append after the successful claim/session statements, in the SAME batch. */
export function prepareActivatePlatformAnnouncementVerification(db: D1Database, input: {
  grantType: VerificationGrantType; grantId: string; attendeeId: string; sessionId: string; confirmAnnouncements?: boolean;
}): D1PreparedStatement[] {
  const grant = grantRecord(input.grantType), now = new Date().toISOString();
  if (input.confirmAnnouncements !== true) {
    // A successfully used access link without the disclosed opt-in action must
    // not remain available for later consent replay, even inside a caller retry.
    return [db.prepare(`UPDATE platform_announcement_verifications SET consumed_at = ?
      WHERE grant_type = ? AND grant_id = ? AND consumed_at IS NULL
        AND EXISTS (SELECT 1 FROM ${grant.from} WHERE g.id = grant_id AND g.claimed_session_id = ?)`)
      .bind(now, input.grantType, input.grantId, input.sessionId)];
  }
  const sourceId = `${input.grantType}:${input.grantId}`;
  return [
    db.prepare(`UPDATE platform_announcement_subscriptions SET status = 'subscribed', verified_at = ?, revision = revision + 1, updated_at = ?
      WHERE status = 'pending' AND EXISTS (
        SELECT 1 FROM platform_announcement_verifications v JOIN ${grant.from} ON g.id = v.grant_id AND ${grant.email} = v.email
        JOIN attendee_sessions session ON session.id = g.claimed_session_id AND session.attendee_id = ? AND session.revoked_at IS NULL AND session.expires_at > ?
        JOIN attendee_profiles p ON p.id = session.attendee_id AND p.normalized_email = v.email AND p.email_verified_at IS NOT NULL AND p.status = 'active'
        WHERE v.grant_type = ? AND v.grant_id = ? AND v.consumed_at IS NULL AND g.claimed_session_id = ?
          AND v.email = platform_announcement_subscriptions.email AND v.subscription_revision = platform_announcement_subscriptions.revision
          AND EXISTS (SELECT 1 FROM platform_announcement_choices c WHERE c.email = v.email
            AND c.source = v.source AND c.source_id = v.source_id AND c.opted_in = 1))`)
      .bind(now, now, input.attendeeId, now, input.grantType, input.grantId, input.sessionId),
    db.prepare(`INSERT INTO platform_announcement_choices (id, email, source, source_id, opted_in, verified_email, consent_version, created_at)
      SELECT ?, s.email, 'verification', ?, 1, 1, s.consent_version, ? FROM platform_announcement_subscriptions s
      JOIN platform_announcement_verifications v ON v.email = s.email AND s.revision = v.subscription_revision + 1
      WHERE changes() = 1 AND v.grant_type = ? AND v.grant_id = ? AND v.consumed_at IS NULL`)
      .bind(crypto.randomUUID(), sourceId, now, input.grantType, input.grantId),
    db.prepare(`UPDATE platform_announcement_verifications SET consumed_at = ? WHERE changes() = 1 AND grant_type = ? AND grant_id = ? AND consumed_at IS NULL`)
      .bind(now, input.grantType, input.grantId),
  ];
}

/** Read only after email ownership is verified. */
export async function readPlatformAnnouncementPreference(db: D1Database, email: string): Promise<PlatformAnnouncementPreference> {
  const row = await db.prepare("SELECT status, revision FROM platform_announcement_subscriptions WHERE email = ?")
    .bind(normalizedEmail(email)).first<{ status: Exclude<PlatformAnnouncementStatus, "not_subscribed">; revision: number }>();
  return { platformAnnouncementsOptIn: row?.status === "subscribed" || row?.status === "pending", status: row?.status ?? "not_subscribed", revision: row?.revision ?? 0 };
}

/** Verified settings are the only way to reverse an explicit unsubscribe. */
export async function updatePlatformAnnouncementPreference(db: D1Database, input: {
  email: string; attendeeId: string; optedIn: boolean; revision: number;
}): Promise<{ saved: boolean; preference: PlatformAnnouncementPreference }> {
  const email = normalizedEmail(input.email);
  const now = new Date().toISOString(), choiceId = crypto.randomUUID();
  const status = input.optedIn ? "subscribed" : "unsubscribed";
  const [updated] = await db.batch([
    db.prepare(`INSERT INTO platform_announcement_subscriptions
      (email, status, consent_version, consented_at, verified_at, unsubscribed_at, source, source_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 'preferences', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM attendee_profiles WHERE id = ? AND normalized_email = ? AND email_verified_at IS NOT NULL AND status = 'active')
        AND (? = 0 OR EXISTS (SELECT 1 FROM platform_announcement_subscriptions WHERE email = ? AND revision = ?))
      ON CONFLICT(email) DO UPDATE SET
        status = excluded.status, consent_version = excluded.consent_version,
        consented_at = CASE WHEN excluded.status = 'subscribed' THEN excluded.consented_at ELSE platform_announcement_subscriptions.consented_at END,
        verified_at = excluded.verified_at, unsubscribed_at = excluded.unsubscribed_at,
        source = excluded.source, source_id = excluded.source_id,
        revision = platform_announcement_subscriptions.revision + 1, updated_at = excluded.updated_at
      WHERE platform_announcement_subscriptions.revision = ? AND platform_announcement_subscriptions.status <> excluded.status`)
      .bind(email, status, PLATFORM_ANNOUNCEMENT_CONSENT_VERSION, input.optedIn ? now : null, now, input.optedIn ? null : now,
        choiceId, now, now, input.attendeeId, email, input.revision, email, input.revision, input.revision),
    db.prepare(`INSERT INTO platform_announcement_choices
      (id, email, source, source_id, opted_in, verified_email, consent_version, created_at)
      SELECT ?, ?, 'preferences', ?, ?, 1, ?, ? WHERE changes() = 1`)
      .bind(choiceId, email, choiceId, input.optedIn ? 1 : 0, PLATFORM_ANNOUNCEMENT_CONSENT_VERSION, now),
  ]);
  const preference = await readPlatformAnnouncementPreference(db, email);
  return { saved: updated.meta.changes === 1 || (preference.revision === input.revision && preference.status === status), preference };
}

/** For a future campaign composer; does not queue, import or send anything. */
export async function createPlatformAnnouncementUnsubscribeToken(db: D1Database, email: string): Promise<string | null> {
  const token = createSecureToken();
  const result = await db.prepare(`INSERT INTO platform_announcement_unsubscribe_tokens (token_hash, email, subscription_revision, created_at)
    SELECT ?, s.email, s.revision, ? FROM platform_announcement_subscriptions s WHERE s.email = ? AND ${platformAnnouncementEligible}`)
    .bind(await hashToken(token), new Date().toISOString(), normalizedEmail(email)).run();
  return result.meta.changes === 1 ? token : null;
}

export async function unsubscribePlatformAnnouncements(db: D1Database, token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return;
  const tokenHash = await hashToken(token), now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE platform_announcement_subscriptions SET
      status = 'unsubscribed', unsubscribed_at = ?, source = 'unsubscribe', source_id = ?, revision = revision + 1, updated_at = ?
      WHERE status = 'subscribed' AND EXISTS (SELECT 1 FROM platform_announcement_unsubscribe_tokens t
        WHERE t.token_hash = ? AND t.email = platform_announcement_subscriptions.email
          AND t.subscription_revision = platform_announcement_subscriptions.revision)`)
      .bind(now, tokenHash, now, tokenHash),
    db.prepare(`INSERT INTO platform_announcement_choices
      (id, email, source, source_id, opted_in, verified_email, consent_version, created_at)
      SELECT ?, email, 'unsubscribe', ?, 0, 0, consent_version, ? FROM platform_announcement_subscriptions
      WHERE changes() = 1 AND source = 'unsubscribe' AND source_id = ?`)
      .bind(crypto.randomUUID(), tokenHash, now, tokenHash),
  ]);
}
