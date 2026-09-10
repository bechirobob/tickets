import { rememberEventContact, notifyRegistrationHosts } from './event-audience';
import { attendeeCookieHeader, attendeeSessionExpiry, createSecureToken, hashToken } from './attendee-auth';
import { createGateToken, hashGateToken } from './gate-pass';
import { sendEmail } from './email-delivery';
import { recordPolicyConsents } from './policies';

export type RegistrationMode = 'paid' | 'rsvp' | 'interest';
export type RegistrationSettings = { eventSlug: string; title: string; mode: RegistrationMode; capacity: number; maxPartySize: number; approvalRequired: number; roomAccess: number; scheduleStatus: string; startsAt: string; endsAt: string; eventState: string; publication: string; accepting?: number; closesAt?: string | null; notifyHost?: number };
export type Registration = { id: string; eventSlug: string; email: string; guestName: string; phone: string; partySize: number; kind: string; status: string; attendeeId: string | null; orderId: string | null; version: number; eventSignature: string | null };
const fields = `id, event_slug AS eventSlug, normalized_email AS email, guest_name AS guestName, phone, party_size AS partySize, kind, status, attendee_id AS attendeeId, order_id AS orderId, version, event_signature AS eventSignature`;
const timestamp = () => new Date().toISOString();
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
export async function registrationSettings(db: D1Database, slug: string) {
  return db.prepare(`SELECT e.slug AS eventSlug, e.title, e.schedule_status AS scheduleStatus, e.starts_at AS startsAt, e.ends_at AS endsAt, e.event_state AS eventState, e.status AS publication,
    COALESCE(s.mode, CASE WHEN e.schedule_status = 'coming_soon' THEN 'interest' ELSE 'paid' END) AS mode,
    COALESCE(s.capacity, 0) AS capacity, COALESCE(s.max_party_size, 1) AS maxPartySize,
    COALESCE(s.approval_required, 0) AS approvalRequired, COALESCE(s.room_access, 0) AS roomAccess, COALESCE(s.accepting,1) AS accepting, s.closes_at AS closesAt, COALESCE(s.notify_host,1) AS notifyHost
    FROM curated_event_records e LEFT JOIN event_registration_settings s ON s.event_slug = e.slug WHERE e.slug = ? AND e.removed_at IS NULL`).bind(slug).first<RegistrationSettings>();
}
export function registrationStartConfirmed(settings: Pick<RegistrationSettings, 'scheduleStatus' | 'startsAt'>) {
  return ['confirmed', 'end_pending'].includes(settings.scheduleStatus) && Number.isFinite(Date.parse(settings.startsAt));
}
export function registrationsOpen(settings: RegistrationSettings) {
  return settings.accepting !== 0 && (!settings.closesAt || settings.closesAt > timestamp()) && settings.publication === 'published' && !['cancelled', 'postponed'].includes(settings.eventState)
    && (settings.mode === 'rsvp' ? registrationStartConfirmed(settings) && settings.startsAt > timestamp() : settings.scheduleStatus === 'coming_soon' || settings.endsAt > timestamp());
}
export function registrationShareState(settings: RegistrationSettings | null) {
  if (!settings) return {ready:false,mode:'paid',reason:'Choose an available event.'};
  const mode=settings.mode;
  if (settings.publication !== 'published') return {ready:false,mode,reason:'Publish this event before sharing registration.'};
  if (['cancelled','postponed'].includes(settings.eventState)) return {ready:false,mode,reason:'Registration is unavailable while this event is cancelled or postponed.'};
  if (mode === 'rsvp' && !registrationStartConfirmed(settings)) return {ready:false,mode,reason:'Confirm the event date and start time before opening RSVP.'};
  if (mode === 'paid' && settings.scheduleStatus !== 'confirmed') return {ready:false,mode,reason:'Confirm the event date and end time before opening paid registration.'};
  if (!registrationsOpen(settings)) return {ready:false,mode,reason:'Registration is closed. Check the opening switch, deadline and event date.'};
  return {ready:true,mode,reason:''};
}
function signature(s: RegistrationSettings) { return JSON.stringify([s.scheduleStatus, s.startsAt, s.endsAt, s.eventState, s.mode]); }
export async function readRegistration(db: D1Database, id: string) { return db.prepare(`SELECT ${fields} FROM event_registrations WHERE id = ?`).bind(id).first<Registration>(); }

export async function requestRegistration(db: D1Database, input: { eventSlug: string; email: string; guestName: string; phone: string; partySize: number; announcementsOptIn?: boolean }, origin: string, directRsvp = false) {
  const settings = await registrationSettings(db, input.eventSlug);
  if (!settings || !registrationsOpen(settings) || settings.mode === 'paid') throw new Error('Registration is not open for this event.');
  if (settings.mode === 'rsvp' && !registrationStartConfirmed(settings)) throw new Error('RSVP opens when the event date is confirmed.');
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > (settings.mode === 'interest' ? 1 : settings.maxPartySize)) throw new Error('Choose an allowed number of guests.');
  const now = timestamp();
  await db.prepare(`INSERT OR IGNORE INTO event_registrations (id, event_slug, normalized_email, guest_name, phone, party_size, kind, status, event_signature, created_at, updated_at, announcements_opt_in)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?, ?, ?)`).bind(crypto.randomUUID(), input.eventSlug, input.email, input.guestName, input.phone, input.partySize, settings.mode, signature(settings), now, now, input.announcementsOptIn ? 1 : 0).run();
  const reg = await db.prepare(`SELECT ${fields} FROM event_registrations WHERE event_slug = ? AND normalized_email = ?`).bind(input.eventSlug, input.email).first<Registration>();
  if (!reg) throw new Error('Registration could not be saved. Try again.');
  await recordPolicyConsents({ db, subjectType: 'registration', subjectId: reg.id, actorEmail: input.email, policyKeys: ['purchase', 'privacy'] });
  if (directRsvp && settings.mode === 'rsvp') {
    // Submission is a guest request, not proof of email ownership. Keep the
    // existing identity and consent on retries; never create an account here.
    await db.prepare(`UPDATE event_registrations SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'unverified'`)
      .bind(settings.approvalRequired ? 'requested' : 'waitlisted', now, reg.id).run();
    await promoteRegistrations(db, reg.eventSlug);
    const current = await readRegistration(db, reg.id);
    if (current) await notifyRegistrationHosts(db, { eventSlug: reg.eventSlug, sourceId: reg.id, guestName: reg.guestName, status: current.status, guests: reg.partySize });
    return { mode: settings.mode };
  }
  await sendRegistrationAccess(db, reg, settings.title, origin);
  return { mode: settings.mode };
}
export async function sendRegistrationAccess(db: D1Database, reg: Registration, title: string, origin: string) {
  const recent = await db.prepare(`SELECT COUNT(*) AS count FROM registration_access_grants WHERE registration_id = ? AND created_at > ?`).bind(reg.id, new Date(Date.now() - 15 * 60000).toISOString()).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 3) return;
  const token = createSecureToken();
  await db.prepare(`INSERT INTO registration_access_grants (id, registration_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), reg.id, await hashToken(token), new Date(Date.now() + 20 * 60000).toISOString(), timestamp()).run();
  const url = `${origin}/rsvp/access#token=${encodeURIComponent(token)}`;
  const subject = `Confirm your email · ${title}`;
  const text = `Hi ${reg.guestName},\n\nOpen this link to confirm your email and view your registration for ${title}:\n${url}\n\nThis link expires in 20 minutes. A place is only reserved after your RSVP is confirmed. If you did not request this, you can ignore it.`;
  await sendEmail({ db, kind: 'registration_access', recipient: reg.email, subject, text, html: `<p>Hi ${escape(reg.guestName)},</p><p>Confirm your email to continue with ${escape(title)}.</p><p><a href="${escape(url)}">View my registration</a></p><p>This link expires in 20 minutes. A place is only reserved after your RSVP is confirmed.</p>`, idempotencyKey: `registration-access/${await hashToken(token)}` });
}

// Capacity is reserved atomically, including guests who have not verified an
// email. Account passes are issued only after ownership is independently proven.
// A unique order and deterministic ticket IDs make retries harmless.
export async function confirmRegistration(db: D1Database, id: string) {
  const reg = await readRegistration(db, id);
  if (!reg) return false;
  const now = timestamp();
  const orderId = `rsvp_${reg.id}`;
  const confirmed = `EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND status = 'confirmed' AND attendee_id IS NOT NULL AND verified_at IS NOT NULL)`;
  const statements = [db.prepare(`UPDATE event_registrations SET status = 'confirmed', version = version + 1, updated_at = ?
    WHERE id = ? AND kind = 'rsvp' AND status = 'waitlisted'
    AND EXISTS (SELECT 1 FROM event_registration_settings s JOIN curated_event_records e ON e.slug = s.event_slug
      WHERE s.event_slug = event_registrations.event_slug AND s.mode = 'rsvp' AND e.status = 'published' AND e.schedule_status IN ('confirmed', 'end_pending')
      AND e.event_state IN ('on_sale', 'sold_out', 'rescheduled') AND e.starts_at > ?
      AND (s.approval_required = 0 OR event_registrations.approved_at IS NOT NULL)
      AND event_registrations.party_size <= s.max_party_size
      AND (SELECT COALESCE(SUM(party_size), 0) FROM event_registrations r WHERE r.event_slug = s.event_slug AND r.status = 'confirmed') + event_registrations.party_size <= s.capacity)
    AND NOT EXISTS (SELECT 1 FROM event_registrations earlier JOIN event_registration_settings s ON s.event_slug = earlier.event_slug
      WHERE earlier.event_slug = event_registrations.event_slug AND earlier.status = 'waitlisted'
      AND (s.approval_required = 0 OR earlier.approved_at IS NOT NULL)
      AND (earlier.created_at < event_registrations.created_at OR (earlier.created_at = event_registrations.created_at AND earlier.id < event_registrations.id)))`)
    .bind(now, id, now),
    db.prepare(`UPDATE event_registrations SET order_id = ? WHERE id = ? AND status = 'confirmed' AND attendee_id IS NOT NULL AND verified_at IS NOT NULL`).bind(orderId, id),
    db.prepare(`INSERT OR IGNORE INTO orders (id, reference, event_slug, ticket_type, quantity, unit_quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, payment_provider, status, created_at, paid_at)
      SELECT ?, ?, event_slug, 'RSVP', party_size, party_size, 0, 0, 0, 'GHS', normalized_email, phone, guest_name, 'rsvp', 'rsvp', 'paid', ?, ? FROM event_registrations WHERE id = ? AND status = 'confirmed' AND attendee_id IS NOT NULL AND verified_at IS NOT NULL`)
      .bind(orderId, `RSVP-${reg.id}`, now, now, id),
  ];
  for (let index = 0; index < reg.partySize; index++) {
    const ticketId = `${orderId}:${index}`;
    const token = createGateToken();
    statements.push(db.prepare(`INSERT OR IGNORE INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at, admission_number)
      SELECT ?, ?, ?, 'RSVP', ?, 'issued', ?, ? WHERE ${confirmed}`).bind(ticketId, orderId, reg.eventSlug, await hashGateToken(token), now, index + 1, id));
    statements.push(db.prepare(`INSERT OR IGNORE INTO ticket_gate_credentials (ticket_id, token, issued_at) SELECT ?, ?, ? WHERE ${confirmed}`).bind(ticketId, token, now, id));
    statements.push(db.prepare(`INSERT OR IGNORE INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
      SELECT ?, ?, 'rsvp', 'active', ? WHERE ${confirmed}`).bind(ticketId, reg.attendeeId, now, id));
  }
  statements.push(db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ? AND payment_provider = 'rsvp' AND ${confirmed}`).bind(orderId, id));
  statements.push(db.prepare(`UPDATE tickets SET status = 'issued' WHERE order_id = ? AND status = 'voided' AND ${confirmed}`).bind(orderId, id));
  const [changed] = await db.batch(statements);
  return changed.meta.changes === 1;
}
export async function promoteRegistrations(db: D1Database, eventSlug: string) {
  const rows = await db.prepare(`SELECT r.id FROM event_registrations r JOIN event_registration_settings s ON s.event_slug = r.event_slug
    WHERE r.event_slug = ? AND r.status = 'waitlisted' AND (s.approval_required = 0 OR r.approved_at IS NOT NULL) ORDER BY r.created_at, r.id LIMIT 30`).bind(eventSlug).all<{ id: string }>();
  for (const row of rows.results) { if (!(await confirmRegistration(db, row.id))) break; }
}
export async function claimRegistration(db: D1Database, token: string) {
  const grant = await db.prepare(`SELECT id, registration_id AS registrationId FROM registration_access_grants WHERE token_hash = ? AND claimed_session_id IS NULL AND expires_at > ?`)
    .bind(await hashToken(token), timestamp()).first<{ id: string; registrationId: string }>();
  if (!grant) throw new Error('This link has expired or was already used. Request another from the event page.');
  const reg = await readRegistration(db, grant.registrationId);
  if (!reg) throw new Error('Registration not found.');
  const settings = await registrationSettings(db, reg.eventSlug);
  if (!settings || (reg.status === 'unverified' && !registrationsOpen(settings))) throw new Error('This event is not accepting registrations.');
  const existing = await db.prepare(`SELECT id, status FROM attendee_profiles WHERE normalized_email = ? AND email_verified_at IS NOT NULL`).bind(reg.email).first<{ id: string; status: string }>();
  if (existing?.status === 'suspended') throw new Error('This account cannot register.');
  const attendeeId = existing?.id ?? `member_${(await hashToken(reg.email)).slice(0, 32)}`;
  const sessionId = crypto.randomUUID(), sessionToken = createSecureToken(), now = timestamp();
  const owns = `EXISTS (SELECT 1 FROM registration_access_grants WHERE id = ? AND claimed_session_id = ?)`;
  const [claimed] = await db.batch([
    db.prepare(`UPDATE registration_access_grants SET claimed_session_id = ? WHERE id = ? AND claimed_session_id IS NULL AND expires_at > ?`).bind(sessionId, grant.id, now),
    db.prepare(`INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, email_verified_at, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'active', ?, ? WHERE ${owns} ON CONFLICT(id) DO NOTHING`)
      .bind(attendeeId, reg.email, reg.phone, reg.guestName.slice(0, 50), now, now, now, grant.id, sessionId),
    db.prepare(`INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${owns}`).bind(sessionId, attendeeId, await hashToken(sessionToken), attendeeSessionExpiry(), now, now, grant.id, sessionId),
    db.prepare(`UPDATE event_registrations SET attendee_id = ?, verified_at = COALESCE(verified_at, ?),
      status = CASE WHEN status = 'unverified' THEN CASE WHEN kind = 'interest' THEN 'interested' WHEN ? = 1 THEN 'requested' ELSE 'waitlisted' END ELSE status END,
      version = version + CASE WHEN status = 'unverified' THEN 1 ELSE 0 END, updated_at = ? WHERE id = ? AND ${owns}`)
      .bind(attendeeId, now, settings.approvalRequired, now, reg.id, grant.id, sessionId),
  ]);
  if (claimed.meta.changes !== 1) throw new Error('This link was already used. Request another from the event page.');
  const consent = await db.prepare('SELECT announcements_opt_in AS optedIn, created_at AS createdAt FROM event_registrations WHERE id=?').bind(reg.id).first<{optedIn:number;createdAt:string}>();
  await rememberEventContact(db,{eventSlug:reg.eventSlug,email:reg.email,guestName:reg.guestName,source:reg.kind,consentedAt:consent?.optedIn ? consent.createdAt : null});
  await promoteRegistrations(db, reg.eventSlug);
  // A host may already have reserved a place before this legacy access claim.
  if (reg.status === 'confirmed') await confirmRegistration(db, reg.id);
  const registration=await readRegistration(db,reg.id);
  if(registration) await notifyRegistrationHosts(db,{eventSlug:reg.eventSlug,sourceId:reg.id,guestName:reg.guestName,status:registration.status,guests:reg.partySize});
  return { registration, cookie: attendeeCookieHeader(sessionToken) };
}
export async function cancelRegistration(db: D1Database, id: string) {
  const reg = await readRegistration(db, id);
  if (!reg) throw new Error('Registration not found.');
  const now = timestamp();
  const [result] = await db.batch([
    db.prepare(`UPDATE event_registrations SET status = 'cancelled', version = version + 1, updated_at = ? WHERE id = ? AND status IN ('interested', 'requested', 'waitlisted', 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM tickets WHERE order_id = event_registrations.order_id AND status = 'checked_in')`).bind(now, id),
    db.prepare(`UPDATE tickets SET status = 'voided' WHERE order_id = ? AND status = 'issued' AND EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND status = 'cancelled')`).bind(reg.orderId, id),
    db.prepare(`UPDATE orders SET status = 'expired' WHERE id = ? AND payment_provider = 'rsvp' AND EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND status = 'cancelled')`).bind(reg.orderId, id),
  ]);
  if (reg.kind === 'interest') await db.prepare('UPDATE event_audience_contacts SET unsubscribed_at=? WHERE event_slug=? AND email=?').bind(now,reg.eventSlug,reg.email).run();
  if (!result.meta.changes && reg.status !== 'cancelled') throw new Error('This registration cannot be cancelled after check-in.');
  const { env } = await import('cloudflare:workers');
  if (reg.attendeeId) await env.THE_ROOM.getByName(reg.eventSlug).suspendAttendee(reg.attendeeId);
  await promoteRegistrations(db, reg.eventSlug);
}
export const registrationStatusText: Record<string, string> = { unverified: 'Check your email', interested: 'You’re in for updates. Book a spot when the date drops.', requested: 'Waiting for the host’s nod.', waitlisted: 'Full house for now. You’re on the waitlist.', confirmed: 'You’re on the list. Your passes are in My Nights.', cancelled: 'Your RSVP is cancelled. Catch you at the next one.', declined: 'The host couldn’t fit you in this time.' };
export async function processRegistrations(env: Cloudflare.Env, origin: string) {
  const events = await env.DB.prepare(`SELECT DISTINCT event_slug AS slug FROM event_registrations WHERE status IN ('waitlisted', 'interested')`).all<{ slug: string }>();
  for (const event of events.results) {
    await promoteRegistrations(env.DB, event.slug);
    const s = await registrationSettings(env.DB, event.slug);
    if (!s || s.publication !== 'published') continue;
    await env.DB.prepare(`UPDATE event_registrations SET event_signature = ?, version = version + 1, updated_at = ? WHERE event_slug = ? AND status = 'interested' AND event_signature <> ?`)
      .bind(signature(s), timestamp(), event.slug, signature(s)).run();
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  const rows = await env.DB.prepare(`SELECT ${fields} FROM event_registrations WHERE verified_at IS NOT NULL AND version > notified_version AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = event_registrations.event_slug AND e.removed_at IS NOT NULL) ORDER BY updated_at LIMIT 40`).all<Registration>();
  for (const reg of rows.results) {
    const s = await registrationSettings(env.DB, reg.eventSlug);
    if (!s) continue;
    const detail = reg.status === 'interested' ? `${registrationStatusText.interested} ${s.scheduleStatus === 'coming_soon' ? 'The date is still to be announced.' : `The event is scheduled for ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(s.startsAt))}, Accra time.`} ${s.eventState === 'cancelled' ? 'The event has been cancelled.' : s.mode === 'rsvp' ? 'RSVP is now available on the event page.' : 'Check the event page for current booking details.'}` : registrationStatusText[reg.status];
    const key = `registration-update/${reg.id}/${reg.version}`;
    const queued = await env.DB.prepare(`SELECT 1 AS found FROM delivery_events WHERE kind = 'registration_update' AND json_extract(payload_json, '$.idempotencyKey') = ? LIMIT 1`).bind(key).first();
    if (!queued) await sendEmail({ db: env.DB, kind: 'registration_update', recipient: reg.email, subject: `${s.title} · Registration update`, text: `${detail}\n\n${origin}/event/${reg.eventSlug}\nManage your registration in My Nights.`, html: `<p>${escape(detail)}</p><p><a href="${origin}/event/${reg.eventSlug}">${escape(s.title)}</a></p><p>Manage your registration in My Nights.</p>`, idempotencyKey: key });
    await env.DB.prepare('UPDATE event_registrations SET notified_version = ? WHERE id = ? AND notified_version < ?').bind(reg.version, reg.id, reg.version).run();
  }
}
