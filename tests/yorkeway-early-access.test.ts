import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { hashToken } from '../lib/attendee-auth';
import { retryFailedDeliveries } from '../lib/email-delivery';
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as signupRoute from '../app/api/yorkeway/route';
import * as withdrawRoute from '../app/api/yorkeway/withdraw/route';
import { GET as audience } from '../app/api/admin/yorkeway-audience/route';
import { captureYorkewaySignup, parseYorkewaySignup, withdrawYorkewaySignup, yorkewayEligible, yorkewayWelcomeEmail } from '../lib/yorkeway-early-access';

const origin = 'https://tickets.becoreops.com';
const fixtureEmails = new Set<string>();
const email = () => { const address = `${crypto.randomUUID()}@example.com`; fixtureEmails.add(address); return address; };
const request = (path: string, body: unknown, source = origin) => new Request(`${origin}${path}`, {
  method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function saved(address: string) {
  return env.DB.prepare('SELECT * FROM yorkeway_early_access WHERE email=?').bind(address).first<Record<string, unknown>>();
}
type Delivery = { id: string; status: string; payload: string; attempts: number; providerId: string | null };
async function delivery(address: string) {
  return env.DB.prepare("SELECT id,status,payload_json AS payload,attempt_count AS attempts,provider_id AS providerId FROM delivery_events WHERE recipient=? AND kind='yorkeway_welcome'")
    .bind(address).first<Delivery>();
}
async function withdrawalToken(address: string) {
  const row = await delivery(address);
  return (JSON.parse(row!.payload) as { text: string }).text.match(/\/unsubscribe#([\w-]+)/)![1];
}
async function eligible(address: string) {
  return env.DB.prepare(`SELECT 1 FROM yorkeway_early_access s WHERE email=? AND ${yorkewayEligible}`).bind(address).first();
}
async function staffCookie(role = 'owner', change = 0) {
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts
    (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,'Staff',?,'test','test',1,?,'active',?,?,'test',?)`)
    .bind(id, email(), role, change, stamp, stamp, stamp).run();
  return adminCookieHeader(await createStaffSession(env.DB, { id })).split(';')[0];
}
async function suppress(address: string, status: 'bounced' | 'complained' | 'suppressed', providerEvent = true) {
  const stamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO delivery_events
    (id,kind,recipient,status,attempt_count,provider_event_at,created_at,updated_at)
    VALUES (?,'support_update',?,?,1,?,?,?)`)
    .bind(crypto.randomUUID(), address, status, providerEvent ? stamp : null, stamp, stamp).run();
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'synthetic-message' }))); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  const addresses = JSON.stringify([...fixtureEmails]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM delivery_events WHERE recipient IN (SELECT value FROM json_each(?))').bind(addresses),
    env.DB.prepare('DELETE FROM yorkeway_early_access WHERE email IN (SELECT value FROM json_each(?))').bind(addresses),
    env.DB.prepare('DELETE FROM marketing_contacts WHERE email IN (SELECT value FROM json_each(?))').bind(addresses),
  ]);
  fixtureEmails.clear();
});

describe('Yorke Way isolated single opt-in', () => {
  it('requires explicit consent and bounded input', () => {
    for (const consent of [false, undefined, 'true', 1]) expect(parseYorkewaySignup({ name: 'Guest', email: 'a@example.com', consent })).toBeNull();
    expect(parseYorkewaySignup({ name: 'x'.repeat(101), email: 'a@example.com', consent: true })).toBeNull();
    expect(parseYorkewaySignup({ name: 'Guest\nName', email: 'a@example.com', consent: true })).toBeNull();
    expect(parseYorkewaySignup({ name: 'Guest', email: 'bad', consent: true })).toBeNull();
    expect(parseYorkewaySignup({ name: 'Guest', email: `${'x'.repeat(250)}@example.com`, consent: true })).toBeNull();
    expect(parseYorkewaySignup({ name: ' Guest ', email: ' A@EXAMPLE.COM ', consent: true })).toEqual({ name: 'Guest', email: 'a@example.com' });
  });
  it('joins immediately without claiming email ownership was verified', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    const row = await saved(address);
    expect(row?.status).toBe('subscribed'); expect(await eligible(address)).not.toBeNull();
    expect(row).not.toHaveProperty('verified_at'); expect(row).not.toHaveProperty('email_verified'); expect(row).not.toHaveProperty('confirmed_grant');
    expect(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='yorkeway_signup_grants'").first()).toBeNull();
  });
  it('queues one welcome with only a hashed withdrawal secret on the subscription', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    const row = await saved(address), outbox = await delivery(address), token = await withdrawalToken(address);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u); expect(row?.withdrawal_hash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token); expect(outbox?.id).toBe(`yorkeway-welcome/${row?.id}`);
    const payload = JSON.parse(outbox!.payload) as { idempotencyKey: string; provider: string; html: string; text: string };
    expect(payload.idempotencyKey).toBe(outbox?.id); expect(payload.provider).toBe('resend');
    expect(payload.text).not.toContain('/confirm'); expect(payload.html).not.toContain('/confirm'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rolls consent back if durable welcome creation fails', async () => {
    const address = email();
    await env.DB.exec("CREATE TRIGGER yorkeway_test_outbox_failure BEFORE INSERT ON delivery_events WHEN NEW.kind='yorkeway_welcome' BEGIN SELECT RAISE(ABORT,'Synthetic outbox failure'); END;");
    try {
      await expect(captureYorkewaySignup(env.DB, { email: address, name: 'Guest' })).rejects.toThrow();
      expect(await saved(address)).toBeNull(); expect(await delivery(address)).toBeNull();
    } finally { await env.DB.exec('DROP TRIGGER yorkeway_test_outbox_failure;'); }
    await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    expect((await saved(address))?.status).toBe('subscribed'); expect(await delivery(address)).not.toBeNull();
  });
  it('creates no account, registration, wider subscription, provider contact or campaign email', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    expect(await env.DB.prepare('SELECT 1 FROM attendee_profiles WHERE normalized_email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM event_registrations WHERE normalized_email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM platform_announcement_subscriptions WHERE email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM marketing_contacts WHERE email=?').bind(address).first()).toBeNull();
    expect((await env.DB.prepare('SELECT kind FROM delivery_events WHERE recipient=?').bind(address).all()).results).toEqual([{ kind: 'yorkeway_welcome' }]);
  });
  it('does not import existing contacts into the separate list', async () => {
    const existing = email();
    await env.DB.prepare('INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) VALUES(?,?,0,?)')
      .bind(existing, crypto.randomUUID(), new Date().toISOString()).run();
    await captureYorkewaySignup(env.DB, { email: email(), name: 'New guest' });
    expect(await saved(existing)).toBeNull(); expect(await delivery(existing)).toBeNull();
  });
  it('duplicate submissions preserve first consent and queue no second welcome', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Original' });
    const before = await saved(address), initial = await delivery(address);
    await captureYorkewaySignup(env.DB, { email: address, name: 'Changed' });
    expect(await saved(address)).toEqual(before); expect(await delivery(address)).toEqual(initial);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=?').bind(address).first<{ n: number }>())?.n).toBe(1);
  });
  it('deduplicates simultaneous submissions atomically', async () => {
    const address = email(); await Promise.all(Array.from({ length: 5 }, () => captureYorkewaySignup(env.DB, { email: address, name: 'Guest' })));
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM yorkeway_early_access WHERE email=?').bind(address).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=?').bind(address).first<{ n: number }>())?.n).toBe(1);
    expect(await eligible(address)).not.toBeNull();
  });
  it('withdraws immediately and repeated withdrawal is harmless', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' }); const token = await withdrawalToken(address);
    await withdrawYorkewaySignup(env.DB, token); const before = await saved(address);
    expect(before?.status).toBe('withdrawn'); expect(before?.withdrawn_at).toBeTruthy(); expect(await eligible(address)).toBeNull();
    await withdrawYorkewaySignup(env.DB, token); expect(await saved(address)).toEqual(before);
  });
  it('never resubscribes or queues another welcome after withdrawal', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    await withdrawYorkewaySignup(env.DB, await withdrawalToken(address)); const before = await saved(address);
    await captureYorkewaySignup(env.DB, { email: address, name: 'Another name' });
    expect(await saved(address)).toEqual(before);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=?').bind(address).first<{ n: number }>())?.n).toBe(1);
  });
  it('invalid and unrelated withdrawal tokens cannot change a subscription', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' }); const before = await saved(address);
    for (const token of ['', 'short', 'x'.repeat(44), 'x'.repeat(43)]) await withdrawYorkewaySignup(env.DB, token);
    expect(await saved(address)).toEqual(before);
  });
  it('respects provider-wide suppression without queuing welcome mail', async () => {
    const address = email(); await env.DB.prepare('INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) VALUES(?,?,1,?)')
      .bind(address, crypto.randomUUID(), new Date().toISOString()).run();
    await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    expect(await delivery(address)).toBeNull(); expect(await eligible(address)).toBeNull();
  });
  it('excludes known bounces, complaints and provider suppression', async () => {
    for (const status of ['bounced', 'complained', 'suppressed'] as const) {
      const address = email(); await suppress(address, status);
      await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
      expect(await delivery(address)).toBeNull(); expect(await eligible(address)).toBeNull();
    }
  });
  it('does not mistake internally cancelled mail for provider suppression', async () => {
    const address = email(); await suppress(address, 'suppressed', false);
    await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    expect(await delivery(address)).not.toBeNull(); expect(await eligible(address)).not.toBeNull();
  });
  it('rejects cross-origin writes and oversized requests', async () => {
    expect((await signupRoute.POST(request('/api/yorkeway', { name: 'Guest', email: email(), consent: true }, 'https://evil.example'))).status).toBe(403);
    expect((await signupRoute.POST(request('/api/yorkeway', { name: 'x'.repeat(3000), email: email(), consent: true }))).status).toBe(413);
    expect((await withdrawRoute.POST(request('/api/yorkeway/withdraw', { token: 'x' }, 'https://evil.example'))).status).toBe(403);
    expect((await withdrawRoute.POST(request('/api/yorkeway/withdraw', { token: 'x'.repeat(2048) }))).status).toBe(413);
  });
  it('rejects missing consent without saving the address and exposes no GET mutations', async () => {
    const address = email();
    expect((await signupRoute.POST(request('/api/yorkeway', { name: 'Guest', email: address, consent: false }))).status).toBe(400);
    expect(await saved(address)).toBeNull(); expect(signupRoute).not.toHaveProperty('GET'); expect(withdrawRoute).not.toHaveProperty('GET');
  });
  it('returns a generic private response without personal data or verification claims', async () => {
    const address = email(), response = await signupRoute.POST(request('/api/yorkeway', { name: 'Guest', email: address, consent: true }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get('cache-control')).toContain('no-store'); expect((await saved(address))?.status).toBe('subscribed');
  });
  it('closes new signups at the end of the stated 2026 period', async () => {
    const address = email(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-01-01T00:00:00.000Z'));
    expect((await signupRoute.POST(request('/api/yorkeway', { name: 'Guest', email: address, consent: true }))).status).toBe(410);
    expect(await saved(address)).toBeNull();
  });
  it('keeps the contact list private from anonymous users and unauthorized staff', async () => {
    const anonymous = await audience(new Request(`${origin}/api/admin/yorkeway-audience`));
    expect(anonymous.status).toBe(403); expect(anonymous.headers.get('cache-control')).toContain('private');
    for (const [role, change] of [['organizer', 0], ['support', 0], ['owner', 1]] as const) {
      expect((await audience(new Request(`${origin}/api/admin/yorkeway-audience`, { headers: { cookie: await staffCookie(role, change) } }))).status).toBe(403);
    }
  });
  it('shows the owner only active unsuppressed signups and never calls them verified', async () => {
    const active = email(), withdrawn = email(), suppressed = email();
    for (const address of [active, withdrawn, suppressed]) await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    await withdrawYorkewaySignup(env.DB, await withdrawalToken(withdrawn)); await suppress(suppressed, 'complained');
    const response = await audience(new Request(`${origin}/api/admin/yorkeway-audience`, { headers: { cookie: await staffCookie() } }));
    expect(response.status).toBe(200);
    const body = await response.json() as { contacts: { email: string; verifiedAt?: string }[]; emailOwnershipVerified: boolean; deliveryEnabled: boolean };
    expect(body.contacts.map(contact => contact.email)).toContain(active);
    expect(body.contacts.map(contact => contact.email)).not.toContain(withdrawn); expect(body.contacts.map(contact => contact.email)).not.toContain(suppressed);
    expect(body.emailOwnershipVerified).toBe(false); expect(body.deliveryEnabled).toBe(false);
    expect(body.contacts.every(contact => !contact.verifiedAt)).toBe(true); expect(JSON.stringify(body)).not.toMatch(/withdrawal_hash|token_hash|yorkeway-welcome\//u);
  });
  it('suppresses a queued welcome after withdrawal without a provider call', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    await withdrawYorkewaySignup(env.DB, await withdrawalToken(address)); await retryFailedDeliveries(env);
    expect(fetch).not.toHaveBeenCalled(); expect((await delivery(address))?.status).toBe('suppressed');
  });
  it('rechecks provider suppression before sending queued welcome mail', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' }); await suppress(address, 'complained');
    await retryFailedDeliveries(env); expect(fetch).not.toHaveBeenCalled(); expect((await delivery(address))?.status).toBe('suppressed');
  });
  it('retries the same outbox after provider failure without duplicate signup mail', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' }); const original = await delivery(address);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Synthetic provider outage'));
    await retryFailedDeliveries(env); expect((await delivery(address))?.status).toBe('failed');
    await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(original!.id).run();
    await retryFailedDeliveries(env); expect((await delivery(address))?.status).toBe('sent');
    expect((await delivery(address))?.id).toBe(original!.id); expect(fetch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(fetch).mock.calls[0][1] as RequestInit, second = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    expect(new Headers(first.headers).get('idempotency-key')).toBe(original!.id); expect(new Headers(second.headers).get('idempotency-key')).toBe(original!.id);
    await captureYorkewaySignup(env.DB, { email: address, name: 'Repeat guest' }); await retryFailedDeliveries(env); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('routes new welcomes through the configured VPS with stable idempotency and no duplicate mail', async () => {
    const previousProvider = env.TRANSACTIONAL_EMAIL_PROVIDER, previousKey = env.VPS_EMAIL_SIGNING_KEY;
    try {
      env.TRANSACTIONAL_EMAIL_PROVIDER = 'vps'; env.VPS_EMAIL_SIGNING_KEY = 'synthetic-signing-key-for-isolated-tests';
      const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
      const original = await delivery(address);
      expect(JSON.parse(original!.payload).provider).toBe('vps');
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: 'vps-' + 'a'.repeat(64) }));
      await retryFailedDeliveries(env);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe('https://mail.becoreops.com/v1/emails');
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({ kind: 'yorkeway_welcome', to: address, idempotencyKey: original!.id });
      expect(new Headers(init!.headers).get('x-tickets-signature')).toMatch(/^[a-f0-9]{64}$/u);
      expect(new Headers(init!.headers).has('authorization')).toBe(false);
      expect((await delivery(address))?.status).toBe('sent');
      await captureYorkewaySignup(env.DB, { email: address, name: 'Repeat guest' });
      await retryFailedDeliveries(env);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (previousProvider === undefined) delete env.TRANSACTIONAL_EMAIL_PROVIDER; else env.TRANSACTIONAL_EMAIL_PROVIDER = previousProvider;
      if (previousKey === undefined) delete env.VPS_EMAIL_SIGNING_KEY; else env.VPS_EMAIL_SIGNING_KEY = previousKey;
    }
  });
  it('preserves an already queued welcome provider when the default changes to VPS', async () => {
    const address = email(); await captureYorkewaySignup(env.DB, { email: address, name: 'Guest' });
    const original = await delivery(address), previousProvider = env.TRANSACTIONAL_EMAIL_PROVIDER;
    expect(JSON.parse(original!.payload).provider).toBe('resend');
    try {
      env.TRANSACTIONAL_EMAIL_PROVIDER = 'vps';
      await retryFailedDeliveries(env);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.resend.com/emails');
      expect((await delivery(address))?.payload).toBe(original!.payload);
      expect(new Headers(vi.mocked(fetch).mock.calls[0][1]!.headers).get('idempotency-key')).toBe(original!.id);
    } finally {
      if (previousProvider === undefined) delete env.TRANSACTIONAL_EMAIL_PROVIDER; else env.TRANSACTIONAL_EMAIL_PROVIDER = previousProvider;
    }
  });
  it('refuses a new welcome when VPS is selected but its existing signing key is unavailable', async () => {
    const previousProvider = env.TRANSACTIONAL_EMAIL_PROVIDER, previousKey = env.VPS_EMAIL_SIGNING_KEY;
    try {
      env.TRANSACTIONAL_EMAIL_PROVIDER = 'vps'; delete env.VPS_EMAIL_SIGNING_KEY;
      const address = email();
      const response = await signupRoute.POST(request('/api/yorkeway', { name: 'Guest', email: address, consent: true }));
      expect(response.status).toBe(503); expect(await saved(address)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (previousProvider === undefined) delete env.TRANSACTIONAL_EMAIL_PROVIDER; else env.TRANSACTIONAL_EMAIL_PROVIDER = previousProvider;
      if (previousKey === undefined) delete env.VPS_EMAIL_SIGNING_KEY; else env.VPS_EMAIL_SIGNING_KEY = previousKey;
    }
  });
  it('uses the approved welcome identity without verification, account or ticket links', () => {
    const message = yorkewayWelcomeEmail('sample-withdrawal');
    expect(message.html).toContain('bgcolor="#301d2c"'); expect(message.html).toContain('bgcolor="#f8f4ec"'); expect(message.html).toContain('bgcolor="#d6f075"');
    expect(message.html).toContain('/hosts/the-yorke-way-email.png'); expect(message.html).toContain('alt="The Yorke Way logo" width="128" height="128"');
    expect(message.html).toContain('Sponsored by BeCore Tickets'); expect(message.subject).toContain('The Yorke Way');
    expect(message.text).toContain('/the-yorke-way/unsubscribe#sample-withdrawal');
    expect(`${message.html} ${message.text}`).not.toMatch(/\/confirm|\/my-nights|confirm your email|verify your email|verification link/iu);
    expect(message.text).toMatch(/not.{0,30}(ticket|RSVP)/iu);
  });
});
