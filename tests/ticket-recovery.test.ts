import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as requestRecovery } from "../app/api/customer/recovery/route";
import { POST as claimRecovery } from "../app/api/customer/recovery/claim/route";
import { POST as preparePasses } from "../app/api/customer/tickets/route";
import { createSecureToken, hashToken, readAttendeeIdentity } from "../lib/attendee-auth";

afterEach(() => vi.unstubAllGlobals());

describe("ticket email delivery and recovery", () => {
  it.each([
    { label: 'issued', ticketStatus: 'issued', eventState: 'on_sale', publication: 'published', archived: false, future: false, direct: true },
    { label: 'checked in', ticketStatus: 'checked_in', eventState: 'on_sale', publication: 'published', archived: false, future: false, direct: true },
    { label: 'sold out', ticketStatus: 'issued', eventState: 'sold_out', publication: 'published', archived: false, future: false, direct: true },
    { label: 'rescheduled', ticketStatus: 'issued', eventState: 'rescheduled', publication: 'published', archived: false, future: false, direct: true },
    { label: 'scheduled and public', ticketStatus: 'issued', eventState: 'on_sale', publication: 'scheduled', archived: false, future: false, direct: true },
    { label: 'cancelled', ticketStatus: 'issued', eventState: 'cancelled', publication: 'published', archived: false, future: false, direct: false },
    { label: 'postponed', ticketStatus: 'checked_in', eventState: 'postponed', publication: 'published', archived: false, future: false, direct: false },
    { label: 'unpublished', ticketStatus: 'issued', eventState: 'on_sale', publication: 'unpublished', archived: false, future: false, direct: false },
    { label: 'archived', ticketStatus: 'issued', eventState: 'on_sale', publication: 'published', archived: true, future: false, direct: false },
    { label: 'scheduled for later', ticketStatus: 'issued', eventState: 'on_sale', publication: 'scheduled', archived: false, future: true, direct: false },
    { label: 'voided', ticketStatus: 'voided', eventState: 'on_sale', publication: 'published', archived: false, future: false, direct: false },
  ])('recovers $label tickets and deep-links only to an available pass page', async ({ ticketStatus, eventState, publication, archived, future, direct }) => {
    const id = crypto.randomUUID(), slug = `recovery-${id}`, email = `${id}@example.com`;
    const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    const token = createSecureToken();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,scheduled_publish_at,archived_at,created_at,updated_at)
        SELECT ?,?,?,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,?,image_url,curation_note,?,?,?,?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`)
        .bind(id, id, slug, eventState, publication, now, future ? expires : now, archived ? now : null, now, now),
      env.DB.prepare(`INSERT INTO orders (id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,status,created_at,paid_at)
        VALUES (?,?,?,'general',1,10000,500,10500,'GHS',?,'233000000000','Recovery Guest','mobile_money:mtn','paid',?,?)`)
        .bind(id, `BCT-${id}`, slug, email, now, now),
      env.DB.prepare(`INSERT INTO tickets (id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',1,?,?,?)`)
        .bind(id, id, slug, `placeholder-${id}`, ticketStatus, now),
      env.DB.prepare('INSERT INTO attendee_recovery_grants (id,normalized_email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
        .bind(id, email, await hashToken(token), expires, now),
    ]);
    const claim = () => claimRecovery(new Request('https://tickets.becoreops.com/api/customer/recovery/claim', {
      method: 'POST', headers: { origin: 'https://tickets.becoreops.com', 'content-type': 'application/json' },
      body: JSON.stringify({ token, redirectTo: 'https://example.invalid/' }),
    }));
    const response = await claim();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: direct ? `/my-nights/${slug}?view=passes&recovered=1` : '/my-nights?recovered=1' });
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const identity = await readAttendeeIdentity(env.DB, cookie);
    expect(identity?.normalizedEmail).toBe(email);
    expect(await env.DB.prepare('SELECT attendee_id AS attendeeId,status FROM ticket_assignments WHERE ticket_id=?').bind(id).first())
      .toEqual({ attendeeId: identity!.attendeeId, status: 'active' });
    expect((await claim()).status).toBe(400);
  });

  it("emails a one-time wallet link and rotates a fresh QR on the recovered device", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `recover-${suffix}@example.com`;
    const orderId = `recover-order-${suffix}`;
    const secondOrderId = `recover-order-second-${suffix}`;
    const ticketId = `recover-ticket-${suffix}`;
    const secondTicketId = `recover-ticket-second-${suffix}`;
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 1_000).toISOString();
    // A valid entry pass requires a real, active event as well as a paid order.
    for (const slug of ['recovery-event','second-recovery-event']) await env.DB.prepare(`
      INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
      SELECT ?,?,?,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',published_at,created_at,updated_at FROM curated_event_records WHERE slug='after-dark-osu'
    `).bind(slug,slug,slug).run();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, ticket_type, quantity, face_amount_minor,
          booking_fee_minor, total_amount_minor, currency, customer_email,
          customer_phone, customer_name, payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'recovery-event', 'general', 1, 10000, 500, 10500, 'GHS', ?,
          '233000000000', 'Recovery Guest', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(orderId, `BCT-RECOVER-${suffix}`, email, now, now),
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, ticket_type, quantity, face_amount_minor,
          booking_fee_minor, total_amount_minor, currency, customer_email,
          customer_phone, customer_name, payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'second-recovery-event', 'general', 1, 9000, 500, 9500, 'GHS', ?,
          '233999999999', 'Second Checkout Name', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(secondOrderId, `BCT-RECOVER-SECOND-${suffix}`, email, later, later),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'recovery-event', 'general', 1, ?, 'issued', ?)
      `).bind(ticketId, orderId, `placeholder-${suffix}`, now),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'second-recovery-event', 'general', 1, ?, 'issued', ?)
      `).bind(secondTicketId, secondOrderId, `placeholder-second-${suffix}`, later),
    ]);

    let emailBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      emailBody = String(init?.body ?? "");
      return Response.json({ id: `email-${suffix}` });
    }));
    const recoveryResponse = await requestRecovery(new Request("https://tickets.becoreops.com/api/customer/recovery", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.20", origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ email }),
    }));
    expect(recoveryResponse.status).toBe(202);
    const sent = JSON.parse(emailBody) as { html: string; text: string };
    expect(sent.html).not.toContain("BCT:");
    expect(sent.html).not.toContain("qr_token");
    const match = sent.text.match(/https:\/\/tickets\.becoreops\.com\/api\/customer\/recovery\/claim\?token=([^\s]+)/u);
    expect(match?.[1]).toBeTruthy();

    const claimResponse = await claimRecovery(new Request('https://tickets.becoreops.com/api/customer/recovery/claim', {method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json'},body:JSON.stringify({token:match![1]})}));
    expect(claimResponse.status).toBe(200);
    expect(await claimResponse.json()).toEqual({redirectTo:"/my-nights?recovered=1"});
    const cookie = claimResponse.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^bct_attendee=/u);

    const walletResponse = await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", { method: "POST", headers: { cookie: cookie!, origin: "https://tickets.becoreops.com" } }));
    expect(walletResponse.status).toBe(200);
    const wallet = await walletResponse.json() as { attendee: { displayName: string; emailVerified: boolean }; orders: Array<{ tickets: Array<{ qrPayload: string; gateCode: string }> }> };
    expect(wallet.attendee).toMatchObject({ displayName: "Second Checkout Name", emailVerified: true });
    expect(wallet.orders).toHaveLength(2);
    expect(wallet.orders[0].tickets[0].qrPayload).toMatch(/^BCT:/u);
    expect(wallet.orders[0].tickets[0].gateCode).toMatch(/^BCT-/u);

    const replay = await claimRecovery(new Request('https://tickets.becoreops.com/api/customer/recovery/claim', {method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json'},body:JSON.stringify({token:match![1]})}));
    expect(replay.status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM attendee_notifications WHERE kind='purchase_confirmation' AND source_id IN (?,?)").bind(`payment-confirmation/${orderId}`,`payment-confirmation/${secondOrderId}`).first()).toEqual({n:2});
  });

  it("does not disclose whether an unknown email has tickets", async () => {
    const response = await requestRecovery(new Request("https://tickets.becoreops.com/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json", origin: "https://tickets.becoreops.com" }, body: JSON.stringify({ email: "unknown@example.com" }) }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ message: "If that email has tickets or registrations, a secure access link is on the way." });
  });
});
