import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as preferences, PUT as savePreference } from "../app/api/customer/platform-announcements/route";
import { GET as audience } from "../app/api/admin/platform-audience/route";
import { POST as unsubscribe } from "../app/api/platform-announcements/unsubscribe/route";
import { POST as verificationPreview } from "../app/api/platform-announcements/verification/route";
import { POST as register } from "../app/api/registrations/route";
import { POST as claimRegistration } from "../app/api/registrations/claim/route";
import { POST as requestRecovery } from "../app/api/customer/recovery/route";
import { POST as claimRecovery } from "../app/api/customer/recovery/claim/route";
import { adminCookieHeader, createStaffSession } from "../lib/admin-session";
import { attendeeCookieHeader, createSecureToken, hashToken } from "../lib/attendee-auth";
import {
  createPlatformAnnouncementUnsubscribeToken, PLATFORM_ANNOUNCEMENT_CONSENT_VERSION,
  readPlatformAnnouncementPreference, recordPlatformAnnouncementChoice, unsubscribePlatformAnnouncements,
  bindPlatformAnnouncementVerification, prepareActivatePlatformAnnouncementVerification,
  preparePlatformAnnouncementChoice, readPlatformAnnouncementVerification,
} from "../lib/platform-announcements";
import { rememberEventContact } from "../lib/event-audience";
import { deliverConfirmedOrder, retryOrderConfirmations } from "../lib/payment-operations";

const origin = "https://tickets.becoreops.com";
const settingsPath = "/api/customer/platform-announcements";
const now = () => new Date().toISOString();
const uniqueEmail = () => `${crypto.randomUUID()}@example.com`;
let allowsProofEmail = false;
async function capture(email: string, sourceId = crypto.randomUUID(), optedIn = true, verifiedEmail = false) {
  const stamp = now();
  await env.DB.prepare(`INSERT OR IGNORE INTO event_registrations
    (id, event_slug, normalized_email, guest_name, kind, status, created_at, updated_at)
    VALUES (?, ?, ?, 'Guest', 'rsvp', 'unverified', ?, ?)`)
    .bind(sourceId, sourceId, email.trim().toLowerCase(), stamp, stamp).run();
  await recordPlatformAnnouncementChoice(env.DB, { email, sourceId, optedIn, verifiedEmail, source: "rsvp" });
}

async function checkout(email: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor,
    total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, created_at)
    VALUES (?, ?, 'test-event', 1, 100, 0, 100, 'GHS', ?, '233000000000', 'card', 'paid', ?)`)
    .bind(id, id, email, now()).run();
  return id;
}

async function rsvpEvent() {
  const eventSlug = `proof-${crypto.randomUUID()}`, stamp = now();
  await env.DB.prepare(`INSERT INTO curated_event_records
    (id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe, price_from_minor, capacity, image_url, curation_note,
     status, schedule_status, event_state, created_at, updated_at)
    SELECT ?, ?, ?, title, venue, area, ?, ?, vibe, price_from_minor, 100, image_url, curation_note,
      'published', 'confirmed', 'on_sale', ?, ? FROM curated_event_records WHERE slug = 'after-dark-osu'`)
    .bind(eventSlug, eventSlug, eventSlug, new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() + 90000000).toISOString(), stamp, stamp).run();
  await env.DB.prepare("INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, updated_at) VALUES (?, 'rsvp', 100, 2, ?)").bind(eventSlug, stamp).run();
  return eventSlug;
}

async function attendee(email = uniqueEmail(), verified = true) {
  const id = crypto.randomUUID(), token = createSecureToken(), stamp = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO attendee_profiles (id, normalized_email, display_name, status, email_verified_at, created_at, updated_at)
      VALUES (?, ?, 'Guest', 'active', ?, ?, ?)`)
      .bind(id, email, verified ? "2020-01-01T00:00:00.000Z" : null, stamp, stamp),
    env.DB.prepare(`INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, await hashToken(token), new Date(Date.now() + 60_000).toISOString(), stamp, stamp),
  ]);
  const session = await env.DB.prepare("SELECT id FROM attendee_sessions WHERE token_hash = ?").bind(await hashToken(token)).first<{ id: string }>();
  return { id, email, sessionId: session!.id, cookie: attendeeCookieHeader(token).split(";")[0] };
}

async function staff(role = "owner", mustChangePassword = false) {
  const id = crypto.randomUUID(), stamp = now();
  await env.DB.prepare(`INSERT INTO staff_accounts
    (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password,
     status, password_changed_at, created_at, created_by, updated_at)
    VALUES (?, ?, 'Staff', ?, 'test', 'test', 1, ?, 'active', ?, ?, 'test', ?)`)
    .bind(id, uniqueEmail(), role, mustChangePassword ? 1 : 0, stamp, stamp, stamp).run();
  return adminCookieHeader(await createStaffSession(env.DB, { id })).split(";")[0];
}

const request = (cookie: string, body?: unknown) => new Request(origin + settingsPath, {
  method: body === undefined ? "GET" : "PUT",
  headers: { cookie, origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const save = (cookie: string, optedIn: boolean, revision: number) =>
  savePreference(request(cookie, { platformAnnouncementsOptIn: optedIn, revision }));
const adminRequest = (cookie: string, query = "") => new Request(`${origin}/api/admin/platform-audience${query}`, { headers: { cookie } });

async function verificationGrant(grantType: "recovery" | "registration", email: string, sourceId: string) {
  const grantId = crypto.randomUUID(), token = createSecureToken(), stamp = now(), expires = new Date(Date.now() + 60_000).toISOString();
  if (grantType === "recovery") {
    await env.DB.prepare("INSERT INTO attendee_recovery_grants (id, normalized_email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(grantId, email, await hashToken(token), expires, stamp).run();
  } else {
    await env.DB.prepare("INSERT INTO registration_access_grants (id, registration_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(grantId, sourceId, await hashToken(token), expires, stamp).run();
  }
  return { grantType, grantId, token };
}

async function claimProof(grant: { grantType: "recovery" | "registration"; grantId: string }, member: { id: string; sessionId: string }, confirmAnnouncements = true) {
  const claim = grant.grantType === "recovery"
    ? env.DB.prepare("UPDATE attendee_recovery_grants SET used_at = ?, claimed_session_id = ? WHERE id = ? AND used_at IS NULL").bind(now(), member.sessionId, grant.grantId)
    : env.DB.prepare("UPDATE registration_access_grants SET claimed_session_id = ? WHERE id = ? AND claimed_session_id IS NULL").bind(member.sessionId, grant.grantId);
  await env.DB.batch([claim, ...prepareActivatePlatformAnnouncementVerification(env.DB, { ...grant, attendeeId: member.id, sessionId: member.sessionId, confirmAnnouncements })]);
}

beforeEach(async () => {
  allowsProofEmail = false;
  await env.DB.batch(["platform_announcement_verifications", "platform_announcement_unsubscribe_tokens", "platform_announcement_choices", "platform_announcement_subscriptions"].map(table => env.DB.prepare(`DELETE FROM ${table}`)));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Platform consent must not contact a provider."));
});
afterEach(() => {
  if (!allowsProofEmail) expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("separate platform consent", () => {
  it("captures only an existing matching source and rolls back with source creation", async () => {
    const email = uniqueEmail(), sourceId = crypto.randomUUID();
    await recordPlatformAnnouncementChoice(env.DB, { email, source: "rsvp", sourceId, optedIn: true });
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "not_subscribed" });
    await expect(env.DB.batch([
      env.DB.prepare(`INSERT INTO event_registrations (id, event_slug, normalized_email, guest_name, kind, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Guest', 'rsvp', 'unverified', ?, ?)`)
        .bind(sourceId, sourceId, email, now(), now()),
      ...preparePlatformAnnouncementChoice(env.DB, { email, source: "rsvp", sourceId, optedIn: true }),
      env.DB.prepare("INSERT INTO platform_announcement_subscriptions (email) VALUES ('force-rollback@example.com')"),
    ])).rejects.toThrow();
    expect(await env.DB.prepare("SELECT id FROM event_registrations WHERE id = ?").bind(sourceId).first()).toBeNull();
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "not_subscribed" });
  });

  it.each(["registration", "recovery"] as const)("finalizes a bound %s proof once, with clear confirmation and no second preference Save", async grantType => {
    const member = await attendee(), sourceId = grantType === "registration" ? crypto.randomUUID() : await checkout(member.email);
    if (grantType === "registration") await capture(member.email, sourceId);
    else await recordPlatformAnnouncementChoice(env.DB, { email: member.email, source: "checkout", sourceId, optedIn: true });
    const grant = await verificationGrant(grantType, member.email, sourceId);
    expect(await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant, sourceId })).toBe(true);
    expect(await readPlatformAnnouncementVerification(env.DB, grant)).toBe(true);
    const preview = await verificationPreview(new Request(`${origin}/api/platform-announcements/verification`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(grant),
    }));
    expect(await preview.json()).toEqual({ confirmsAnnouncements: true });
    await env.DB.batch(prepareActivatePlatformAnnouncementVerification(env.DB, { ...grant, attendeeId: member.id, sessionId: member.sessionId, confirmAnnouncements: true }));
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending" });
    await claimProof(grant, member);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "subscribed", revision: 2 });
    expect(await readPlatformAnnouncementVerification(env.DB, grant)).toBe(false);
    await claimProof(grant, member);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM platform_announcement_choices WHERE email = ? AND source = 'verification'").bind(member.email).first()).toEqual({ count: 1 });
  });

  it("does not bind unrelated/old recovery or silently activate when the claim screen did not confirm", async () => {
    const member = await attendee(), sourceId = crypto.randomUUID();
    await capture(member.email, sourceId);
    const grant = await verificationGrant("recovery", member.email, sourceId);
    expect(await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant })).toBe(false);
    expect(await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant, sourceId })).toBe(false);
    await env.DB.prepare("UPDATE attendee_recovery_grants SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(grant.grantId).run();
    expect(await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant, explicitPreference: true })).toBe(false);
    await env.DB.prepare("UPDATE attendee_recovery_grants SET created_at = ? WHERE id = ?").bind(now(), grant.grantId).run();
    expect(await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant, explicitPreference: true })).toBe(true);
    await claimProof(grant, member, false);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending", revision: 1 });
    await claimProof(grant, member, true);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending", revision: 1 });
  });

  it("rejects mismatched identity and stale proof after unsubscribe or pending-choice revision changes", async () => {
    const member = await attendee(), other = await attendee(), sourceId = crypto.randomUUID();
    await capture(member.email, sourceId);
    const grant = await verificationGrant("registration", member.email, sourceId);
    await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...grant, sourceId });
    await claimProof(grant, other);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending" });
    const freshGrant = await verificationGrant("registration", member.email, sourceId);
    await bindPlatformAnnouncementVerification(env.DB, { email: member.email, ...freshGrant, sourceId });
    await save(member.cookie, false, 1);
    expect(await readPlatformAnnouncementVerification(env.DB, freshGrant)).toBe(false);
    await claimProof(freshGrant, member);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "unsubscribed", revision: 2 });
  });

  it("queues optional updates proof after the new RSVP is already confirmed, then finishes consent through its one-time claim", async () => {
    allowsProofEmail = true;
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "mock-proof-email" }));
    const eventSlug = await rsvpEvent(), email = uniqueEmail();
    const signup = (targetEmail: string, optedIn: boolean, cookie = "") => register(new Request(`${origin}/api/registrations`, {
      method: "POST", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, email: targetEmail, guestName: "Test Guest", phone: "", partySize: 1, acceptedTerms: true, platformAnnouncementsOptIn: optedIn }),
    }));
    expect((await signup(email, true)).status).toBe(202);
    const deliveries = await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE recipient = ? AND kind = 'registration_access'").bind(email).all<{ payload: string }>();
    expect(deliveries.results).toHaveLength(1);
    const { text, html, subject } = JSON.parse(deliveries.results[0].payload) as { text: string; html: string; subject: string };
    expect(subject).toBe("Confirm your BeCore Tickets email updates");
    for (const body of [text, html]) {
      expect(body).toContain("Your RSVP is already saved.");
      expect(body).toContain("BeCore Tickets email updates you chose");
      expect(body).toContain("Email updates are optional and aren’t needed for your RSVP.");
      expect(body).not.toMatch(/continue your registration|place is only reserved|also confirms/u);
    }
    expect(await env.DB.prepare("SELECT status FROM event_registrations WHERE event_slug = ? AND normalized_email = ?").bind(eventSlug, email).first()).toEqual({ status: "confirmed" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets t JOIN orders o ON o.id = t.order_id WHERE o.customer_email = ? AND t.status = 'issued'").bind(email).first()).toEqual({ count: 1 });
    const token = text.match(/#token=([^\s]+)/u)![1];
    expect(await readPlatformAnnouncementVerification(env.DB, { grantType: "registration", token })).toBe(true);
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "pending", revision: 1 });
    expect((await signup(email, true)).status).toBe(202);
    const uncheckedEmail = uniqueEmail();
    expect((await signup(uncheckedEmail, false)).status).toBe(202);
    const verified = await attendee();
    expect((await signup(verified.email, true, verified.cookie)).status).toBe(202);
    expect(await readPlatformAnnouncementPreference(env.DB, verified.email)).toMatchObject({ status: "subscribed" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://api.resend.com/emails");
    const claim = () => claimRegistration(new Request(`${origin}/api/registrations/claim`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token, confirmPlatformAnnouncements: true }),
    }));
    const claimed = await claim();
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({ registration: { status: "confirmed" } });
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "subscribed", revision: 2 });
    expect((await claim()).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare("SELECT consented_at FROM event_audience_contacts WHERE event_slug = ? AND email = ?").bind(eventSlug, email).first()).toEqual({ consented_at: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets t JOIN orders o ON o.id = t.order_id WHERE o.customer_email = ? AND t.status = 'issued'").bind(email).first()).toEqual({ count: 1 });
  });

  it.each(["waitlisted", "requested"] as const)("keeps optional proof separate from a newly saved %s RSVP", async status => {
    allowsProofEmail = true;
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "mock-optional-proof" }));
    const eventSlug = await rsvpEvent(), email = uniqueEmail();
    await env.DB.prepare("UPDATE event_registration_settings SET capacity = ?, approval_required = ? WHERE event_slug = ?")
      .bind(status === "waitlisted" ? 0 : 100, status === "requested" ? 1 : 0, eventSlug).run();
    const response = await register(new Request(`${origin}/api/registrations`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, email, guestName: "Test Guest", phone: "", partySize: 1, acceptedTerms: true, platformAnnouncementsOptIn: true }),
    }));
    expect(response.status).toBe(202);
    expect(await env.DB.prepare("SELECT status FROM event_registrations WHERE event_slug = ? AND normalized_email = ?").bind(eventSlug, email).first()).toEqual({ status });
    const delivery = await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE recipient = ? AND kind = 'registration_access'").bind(email).first<{ payload: string }>();
    const { text, html, subject } = JSON.parse(delivery!.payload) as { text: string; html: string; subject: string };
    expect(subject).toBe("Confirm your BeCore Tickets email updates");
    for (const body of [text, html]) {
      expect(body).toContain("Your RSVP is already saved.");
      expect(body).toContain("Email updates are optional and aren’t needed for your RSVP.");
      expect(body).not.toMatch(/place is only reserved|continue your registration|RSVP is confirmed/u);
    }
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "pending" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "unchecked", "verified", "unsubscribed"] as const)("keeps completed checkout push delivery and sends email proof only for %s consent", async state => {
    allowsProofEmail = true;
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "mock-checkout-proof" }));
    const member = await attendee(uniqueEmail(), state === "verified" || state === "unsubscribed"), orderId = await checkout(member.email);
    await recordPlatformAnnouncementChoice(env.DB, {
      email: member.email, source: "checkout", sourceId: orderId, optedIn: state !== "unchecked", verifiedEmail: state === "verified" || state === "unsubscribed",
    });
    if (state === "unsubscribed") await save(member.cookie, false, 1);
    await env.DB.prepare("INSERT INTO confirmation_deliveries (id, order_id, status, created_at, completed_at) VALUES (?, ?, 'push', ?, ?)")
      .bind(`payment-confirmation/${orderId}`, orderId, now(), now()).run();
    const order: Parameters<typeof deliverConfirmedOrder>[1] = {
      id: orderId, reference: orderId, eventSlug: "test-event", ticketType: "general", quantity: 1, unitQuantity: 1,
      faceAmountMinor: 100, bookingFeeMinor: 0, totalAmountMinor: 100, currency: "GHS", customerEmail: member.email,
      customerPhone: "233000000000", customerName: "Guest", paymentChannel: "card", status: "paid", paidAt: now(),
      paymentProvider: "paystack", paymentEnvironment: "test", providerReference: null,
    };
    expect(await deliverConfirmedOrder(env.DB, order, origin)).toBe("push");
    expect(await deliverConfirmedOrder(env.DB, order, origin)).toBe("push");
    expect(fetch).toHaveBeenCalledTimes(state === "pending" ? 1 : 0);
    const deliveries = await env.DB.prepare("SELECT recovery_grant_id AS grantId, payload_json AS payload FROM delivery_events WHERE order_id = ? AND kind = 'payment_confirmation'")
      .bind(orderId).all<{ grantId: string; payload: string }>();
    expect(deliveries.results).toHaveLength(state === "pending" ? 1 : 0);
    if (state === "pending") {
      expect(JSON.parse(deliveries.results[0].payload).text).toContain("BeCore Tickets email updates you chose");
      expect(await env.DB.prepare("SELECT subscription_revision FROM platform_announcement_verifications WHERE grant_type = 'recovery' AND grant_id = ?")
        .bind(deliveries.results[0].grantId).first()).toEqual({ subscription_revision: 1 });
      expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending" });
    }
  });

  it("recovers missing checkout proof after push completion was committed, without repeating push or email", async () => {
    allowsProofEmail = true;
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "mock-recovered-proof" }));
    const email = uniqueEmail(), orderId = await checkout(email);
    await recordPlatformAnnouncementChoice(env.DB, { email, source: "checkout", sourceId: orderId, optedIn: true });
    // Simulate a crash after successful push bookkeeping but before proof mail.
    await env.DB.prepare("INSERT INTO confirmation_deliveries (id, order_id, status, created_at, completed_at) VALUES (?, ?, 'push', ?, ?)")
      .bind(`payment-confirmation/${orderId}`, orderId, now(), now()).run();
    expect(await env.DB.prepare("SELECT id FROM delivery_events WHERE order_id = ? AND kind = 'payment_confirmation'").bind(orderId).first()).toBeNull();
    await retryOrderConfirmations(env, origin);
    const delivery = await env.DB.prepare("SELECT recovery_grant_id AS grantId FROM delivery_events WHERE order_id = ? AND kind = 'payment_confirmation'").bind(orderId).first<{ grantId: string }>();
    expect(delivery).not.toBeNull();
    expect(await env.DB.prepare("SELECT subscription_revision FROM platform_announcement_verifications WHERE grant_type = 'recovery' AND grant_id = ?")
      .bind(delivery!.grantId).first()).toEqual({ subscription_revision: 1 });
    expect(await env.DB.prepare("SELECT status FROM confirmation_deliveries WHERE order_id = ?").bind(orderId).first()).toEqual({ status: "push" });
    await retryOrderConfirmations(env, origin);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://api.resend.com/emails");
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "pending" });
  });

  it("keeps RSVP successful after optional proof enqueue failure and recovers through an explicit preference request", async () => {
    allowsProofEmail = true;
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "mock-recovery-after-proof-failure" }));
    const email = uniqueEmail(), eventSlug = await rsvpEvent();
    await env.DB.exec("CREATE TRIGGER fail_platform_proof BEFORE INSERT ON platform_announcement_verifications BEGIN SELECT RAISE(ABORT, 'proof binding fixture failure'); END");
    try {
      const response = await register(new Request(`${origin}/api/registrations`, {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ eventSlug, email, guestName: "Proof Retry Guest", phone: "", partySize: 1, acceptedTerms: true, platformAnnouncementsOptIn: true }),
      }));
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ canManage: true });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_platform_proof");
    }
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "pending", revision: 1 });
    expect(await env.DB.prepare("SELECT status FROM event_registrations WHERE event_slug = ? AND normalized_email = ?").bind(eventSlug, email).first()).toEqual({ status: "confirmed" });
    expect(await env.DB.prepare("SELECT id FROM delivery_events WHERE recipient = ? AND kind = 'registration_access'").bind(email).first()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const recovery = await requestRecovery(new Request(`${origin}/api/customer/recovery`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, confirmPlatformAnnouncements: true }),
    }));
    expect(recovery.status).toBe(202);
    const delivery = await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE recipient = ? AND kind = 'ticket_recovery'").bind(email).first<{ payload: string }>();
    expect(delivery).not.toBeNull();
    const token = (JSON.parse(delivery!.payload).text as string).match(/claim\?token=([^\s]+)/u)![1];
    expect(await readPlatformAnnouncementVerification(env.DB, { grantType: "recovery", token })).toBe(true);
    const claimed = await claimRecovery(new Request(`${origin}/api/customer/recovery/claim`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token, confirmPlatformAnnouncements: true }),
    }));
    expect(claimed.status).toBe(200);
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "subscribed", revision: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not backfill legacy event consent or turn unchecked/replayed submissions into platform consent", async () => {
    const email = uniqueEmail(), sourceId = crypto.randomUUID();
    await rememberEventContact(env.DB, { email, eventSlug: "legacy-event", guestName: "Guest", source: "rsvp", consentedAt: now() });
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "not_subscribed", revision: 0 });
    await capture(email, sourceId, false);
    await capture(email, sourceId, true, true);
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "not_subscribed" });
    await capture(`  ${email.toUpperCase()}  `);
    await capture(email);
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toEqual({ status: "pending", platformAnnouncementsOptIn: true, revision: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM platform_announcement_subscriptions").first()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT consented_at FROM event_audience_contacts WHERE event_slug = 'legacy-event' AND email = ?").bind(email).first()).toMatchObject({ consented_at: expect.any(String) });
  });

  it("requires literal true and stores scope, version, source and time without a retention cutoff", async () => {
    const email = uniqueEmail();
    await capture(email, crypto.randomUUID(), "true" as unknown as boolean);
    expect(await readPlatformAnnouncementPreference(env.DB, email)).toMatchObject({ status: "not_subscribed" });
    const member = await attendee(email);
    await capture(email, crypto.randomUUID(), true, true);
    expect(await env.DB.prepare("SELECT consent_version, source, verified_at FROM platform_announcement_subscriptions WHERE email = ?").bind(email).first())
      .toEqual({ consent_version: PLATFORM_ANNOUNCEMENT_CONSENT_VERSION, source: "rsvp", verified_at: expect.any(String) });
    await env.DB.prepare("UPDATE platform_announcement_subscriptions SET consented_at = '2020-01-01T00:00:00.000Z'").run();
    const response = await audience(adminRequest(await staff()));
    expect(await response.json()).toMatchObject({ contacts: [{ email: member.email }], summary: { subscribed: 1 } });
  });

  it("keeps a newly typed verified member address pending and shields its settings from unverified identities", async () => {
    const member = await attendee(), unverified = await attendee(member.email, false);
    await capture(member.email);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "pending" });
    expect(await (await preferences(request(unverified.cookie))).json())
      .toEqual({ platformAnnouncementsOptIn: false, status: "verification_required", revision: 0, emailVerified: false });
    expect((await save(unverified.cookie, true, 1)).status).toBe(403);
    expect(await (await preferences(request(member.cookie))).json()).toMatchObject({ status: "pending", emailVerified: true, revision: 1 });
    expect(await (await save(member.cookie, true, 1)).json()).toMatchObject({ saved: true, status: "subscribed", revision: 2 });
  });

  it("records each source once under concurrency and deduplicates a verified signup across bookings", async () => {
    const member = await attendee(), sourceId = crypto.randomUUID();
    await Promise.all([capture(member.email, sourceId, true, true), capture(member.email, sourceId, true, true)]);
    await recordPlatformAnnouncementChoice(env.DB, { email: member.email.toUpperCase(), source: "checkout", sourceId: await checkout(member.email), optedIn: true, verifiedEmail: true });
    await capture(member.email, crypto.randomUUID(), false);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toEqual({ status: "subscribed", platformAnnouncementsOptIn: true, revision: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM platform_announcement_choices WHERE source_id = ?").bind(sourceId).first()).toEqual({ count: 1 });
  });

  it("never lets a signup or stale settings replay reverse unsubscribe; only a fresh verified choice can resubscribe", async () => {
    const member = await attendee();
    expect(await (await save(member.cookie, true, 0)).json()).toMatchObject({ saved: true, revision: 1 });
    expect(await (await save(member.cookie, false, 1)).json()).toMatchObject({ saved: true, status: "unsubscribed", revision: 2 });
    await capture(member.email, crypto.randomUUID(), true, true);
    expect((await save(member.cookie, true, 0)).status).toBe(409);
    expect((await save(member.cookie, true, 1)).status).toBe(409);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "unsubscribed", revision: 2 });
    expect(await (await save(member.cookie, true, 2)).json()).toMatchObject({ saved: true, status: "subscribed", revision: 3 });
    expect(await env.DB.prepare("SELECT opted_in FROM platform_announcement_choices WHERE email = ? AND source = 'preferences' ORDER BY created_at, rowid").bind(member.email).all())
      .toMatchObject({ results: [{ opted_in: 1 }, { opted_in: 0 }, { opted_in: 1 }] });
  });

  it("serializes competing preference writes and does not rotate consent on an unchanged Save", async () => {
    const member = await attendee();
    const results = await Promise.all([save(member.cookie, true, 0), save(member.cookie, false, 0)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const current = await readPlatformAnnouncementPreference(env.DB, member.email);
    expect((await save(member.cookie, current.platformAnnouncementsOptIn, current.revision)).status).toBe(200);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toEqual(current);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM platform_announcement_choices WHERE email = ?").bind(member.email).first()).toEqual({ count: 1 });
  });

  it("uses hashed revoke-only unsubscribe tokens and makes repeated/old tokens harmless after deliberate resubscribe", async () => {
    const member = await attendee();
    await save(member.cookie, true, 0);
    const token = await createPlatformAnnouncementUnsubscribeToken(env.DB, member.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(await env.DB.prepare("SELECT token_hash FROM platform_announcement_unsubscribe_tokens WHERE email = ?").bind(member.email).first())
      .toEqual({ token_hash: await hashToken(token!) });
    await unsubscribePlatformAnnouncements(env.DB, createSecureToken());
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "subscribed", revision: 1 });
    const form = new URLSearchParams({ token: token! });
    const response = await unsubscribe(new Request(`${origin}/api/platform-announcements/unsubscribe`, { method: "POST", headers: { origin }, body: form }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/platform-announcements/unsubscribe?done=1");
    await unsubscribePlatformAnnouncements(env.DB, token!);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "unsubscribed", revision: 2 });
    expect(await createPlatformAnnouncementUnsubscribeToken(env.DB, member.email)).toBeNull();
    await save(member.cookie, true, 2);
    await unsubscribePlatformAnnouncements(env.DB, token!);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "subscribed", revision: 3 });
    const currentToken = await createPlatformAnnouncementUnsubscribeToken(env.DB, member.email);
    await save(member.cookie, true, 3);
    await unsubscribePlatformAnnouncements(env.DB, currentToken!);
    expect(await readPlatformAnnouncementPreference(env.DB, member.email)).toMatchObject({ status: "unsubscribed", revision: 4 });
  });

  it("enforces authentication, exact-origin, boolean input and revision validation", async () => {
    const member = await attendee();
    expect((await preferences(request(""))).status).toBe(401);
    expect((await save("", true, 0)).status).toBe(401);
    const crossOrigin = request(member.cookie, { platformAnnouncementsOptIn: true, revision: 0 });
    crossOrigin.headers.set("origin", "https://other.becoreops.com");
    expect((await savePreference(crossOrigin)).status).toBe(403);
    for (const body of [null, {}, { platformAnnouncementsOptIn: "true", revision: 0 }, { platformAnnouncementsOptIn: true, revision: -1 }, { platformAnnouncementsOptIn: true, revision: 0.5 }]) {
      expect((await savePreference(request(member.cookie, body))).status).toBe(400);
    }
    expect((await unsubscribe(new Request(`${origin}/api/platform-announcements/unsubscribe`, { method: "POST", body: new URLSearchParams({ token: createSecureToken() }) }))).status).toBe(403);
    await env.DB.prepare("UPDATE attendee_sessions SET revoked_at = ? WHERE attendee_id = ?").bind(now(), member.id).run();
    expect((await save(member.cookie, true, 0)).status).toBe(401);
  });

  it("keeps the read-only audience owner-only, excludes pending/suspended/provider-suppressed addresses and paginates", async () => {
    const owner = await staff();
    for (const cookie of ["", await staff("organizer"), await staff("curator"), await staff("support"), await staff("owner", true)]) {
      expect((await audience(adminRequest(cookie))).status).toBe(403);
    }
    const first = await attendee(), second = await attendee(), suspended = await attendee(), providerSuppressed = await attendee();
    for (const member of [first, second, suspended, providerSuppressed]) await capture(member.email, crypto.randomUUID(), true, true);
    await capture(uniqueEmail());
    await env.DB.prepare("UPDATE attendee_profiles SET status = 'suspended' WHERE id = ?").bind(suspended.id).run();
    await env.DB.prepare("INSERT INTO marketing_contacts (email, unsubscribed, updated_at) VALUES (?, 1, ?)").bind(providerSuppressed.email, now()).run();
    const page = await (await audience(adminRequest(owner, "?limit=1"))).json() as { contacts: Array<{ email: string }>; nextCursor: string };
    expect(page.contacts).toHaveLength(1);
    const next = await (await audience(adminRequest(owner, `?limit=1&after=${encodeURIComponent(page.nextCursor)}`))).json() as { contacts: Array<{ email: string }>; nextCursor: string | null };
    expect(next.contacts).toHaveLength(1);
    expect(new Set([...page.contacts, ...next.contacts].map(row => row.email))).toEqual(new Set([first.email, second.email]));
    expect(next.nextCursor).toBeNull();
    expect(await (await audience(adminRequest(owner))).json()).toMatchObject({ summary: { total: 5, subscribed: 2, pending: 1, unsubscribed: 0, suppressed: 2 }, deliveryEnabled: false });
    expect(await createPlatformAnnouncementUnsubscribeToken(env.DB, providerSuppressed.email)).toBeNull();
    expect(await env.DB.prepare("SELECT unsubscribed FROM marketing_contacts WHERE email = ?").bind(providerSuppressed.email).first()).toEqual({ unsubscribed: 1 });
  });
});
