import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { POST as preparePasses } from "../app/api/customer/tickets/route";
import { GET as gateManifest, DELETE as undoCheckIn, POST as checkIn } from "../app/api/admin/check-in/route";
import { adminCookieHeader, createStaffSession } from "../lib/admin-session";
import { recordDisputeWebhook } from "../lib/payment-operations";
import { attendeeCookieHeader, hashToken } from "../lib/attendee-auth";

async function seedIssuedTicket(suffix: string) {
  const now = new Date().toISOString();
  const attendeeToken = `attendee-session-token-${suffix}-with-enough-entropy`;
  const attendeeId = `attendee-${suffix}`;
  const orderId = `order-${suffix}`;
  const ticketId = `ticket-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO orders (
        id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor,
        total_amount_minor, currency, customer_email, customer_phone, customer_name,
        payment_channel, status, created_at, paid_at
      ) VALUES (?, ?, 'after-dark-osu', 'general', 1, 12000, 900, 12900, 'GHS', ?,
                '233000000000', 'Gate Guest', 'mobile_money:mtn', 'paid', ?, ?)
    `).bind(orderId, `BCT-GATE-${suffix}`, `gate-${suffix}@example.com`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, status, created_at, updated_at)
      VALUES (?, ?, '233000000000', 'Gate Guest', 'active', ?, ?)
    `).bind(attendeeId, `gate-${suffix}@example.com`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`session-${suffix}`, attendeeId, await hashToken(attendeeToken), new Date(Date.now() + 60_000).toISOString(), now, now),
    env.DB.prepare(`
      INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at)
      VALUES (?, ?, 'after-dark-osu', 'general', ?, 'issued', ?)
    `).bind(ticketId, orderId, `unusable-placeholder-${suffix}`, now),
    env.DB.prepare(`
      INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
      VALUES (?, ?, ?, 'active', ?)
    `).bind(ticketId, attendeeId, `order:${orderId}`, now),
  ]);
  return { attendeeToken, ticketId };
}

async function ownerCookie(suffix: string) {
  const id = `owner-${suffix}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts (
    id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
    must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
  ) VALUES (?, ?, 'Gate Owner', 'owner', 'test', 'test', 1, 0, 'active', 0, ?, ?, 'test', ?)`)
    .bind(id, `${id}@example.com`, now, now, now).run();
  const token = await createStaffSession(env.DB, { id });
  return adminCookieHeader(token).split(";")[0];
}

describe("secure gate passes", () => {
  it("rechecks gate assignment, event state and staff restrictions on every scan", async () => {
    // Keep an active owner while the scanned session's account becomes gate staff.
    await ownerCookie("access-retained-owner");
    const cookie = await ownerCookie("access");
    const slug = "capacity-gate-access", now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (?,?,?,'Access test','Test','Accra',?,?,'Late night',10000,400,'on_sale','https://example.com/test.jpg','Gate access fixture.','published',?,?,?)`).bind(slug,slug,slug,now,now,now,now,now).run();
    await env.DB.prepare("UPDATE staff_accounts SET role = 'gate' WHERE id = 'owner-access'").run();
    const scan = () => checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ code: "BCT-2345-6789-ABCD-EFGH", eventSlug: slug }),
    }));
    expect((await scan()).status).toBe(403);
    await env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES ('owner-access',?,'test',?)").bind(slug,now).run();
    expect((await scan()).status).toBe(404); // Authorized, but the pass does not exist.
    await env.DB.prepare("UPDATE curated_event_records SET event_state = 'postponed' WHERE slug = ?").bind(slug).run();
    expect((await scan()).status).toBe(409);
    await env.DB.prepare("UPDATE curated_event_records SET removed_at = ? WHERE slug = ?").bind(now,slug).run();
    expect((await scan()).status).toBe(403);
    await env.DB.prepare("UPDATE staff_accounts SET must_change_password = 1 WHERE id = 'owner-access'").run();
    expect((await scan()).status).toBe(401);
  });

  it("prepares an opaque QR pass and admits it exactly once", async () => {
    const { attendeeToken, ticketId } = await seedIssuedTicket("once");
    const passesResponse = await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST",
      headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0], origin: "https://tickets.becoreops.com" },
    }));
    expect(passesResponse.status).toBe(200);
    const wallet = await passesResponse.json() as { orders: Array<{ tickets: Array<{ gateCode: string; qrPayload: string }> }> };
    const pass = wallet.orders[0].tickets[0];
    expect(pass.gateCode).toMatch(/^BCT-(?:[2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/u);
    expect(pass.qrPayload).not.toContain("Gate Guest");
    expect(pass.qrPayload).not.toContain("example.com");

    const cookie = await ownerCookie("once");
    const request = () => new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ code: pass.qrPayload, eventSlug: "after-dark-osu", gate: "Gate A" }),
    });
    const responses = await Promise.all([checkIn(request()), checkIn(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<{ result: string; ticket?: { attendeeName?: string; checkedInGate?: string } }>));
    expect(payloads.find((payload) => payload.result === "valid")).toMatchObject({ result: "valid", ticket: { attendeeName: "Gate Guest", checkedInGate: "Gate A" } });
    expect(payloads.find((payload) => payload.result === "duplicate")).toMatchObject({ result: "duplicate" });
    const stored = await env.DB.prepare("SELECT status, checked_in_by AS actor, checked_in_gate AS gate FROM tickets WHERE id = ?")
      .bind(ticketId).first<{ status: string; actor: string; gate: string }>();
    expect(stored).toMatchObject({ status: "checked_in", actor: "Gate Owner <owner-once@example.com>", gate: "Gate A" });
  });

  it("keeps the gate API private and rejects a pass at the wrong event", async () => {
    const unauthorized = await checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "BCT-2345-6789-ABCD-EFGH", eventSlug: "after-dark-osu" }),
    }));
    expect(unauthorized.status).toBe(401);

    const { attendeeToken, ticketId } = await seedIssuedTicket("wrong");
    const wallet = await (await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST",
      headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0], origin: "https://tickets.becoreops.com" },
    }))).json() as { orders: Array<{ tickets: Array<{ gateCode: string }> }> };
    const cookie = await ownerCookie("wrong");
    const response = await checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ code: wallet.orders[0].tickets[0].gateCode, eventSlug: "noir-room-labone" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ result: "wrong_event" });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE id = ?").bind(ticketId).first()).toMatchObject({ status: "issued" });
  });

  it("replays an offline scan idempotently and limits undo to an audited supervisor", async () => {
    const { attendeeToken, ticketId } = await seedIssuedTicket("offline");
    const wallet = await (await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST", headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0], origin: "https://tickets.becoreops.com" },
    }))).json() as { orders: Array<{ tickets: Array<{ gateCode: string }> }> };
    const cookie = await ownerCookie("offline");
    const clientScanId = crypto.randomUUID();
    const scan = () => checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ code: wallet.orders[0].tickets[0].gateCode, eventSlug: "after-dark-osu", gate: "Offline lane", deviceId: "gate-device-a", clientScanId }),
    }));
    expect((await scan()).status).toBe(200);
    const replay = await scan();
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ result: "valid", replayed: true });

    const undone = await undoCheckIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "DELETE", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ ticketId, eventSlug: "after-dark-osu", gate: "Supervisor", reason: "Test correction" }),
    }));
    expect(undone.status).toBe(200);
    await expect(env.DB.prepare("SELECT status FROM tickets WHERE id = ?").bind(ticketId).first()).resolves.toMatchObject({ status: "issued" });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id = ?").bind(ticketId).first()).resolves.toMatchObject({ count: 2 });
  });
});


it.each(['refund_pending', 'refunded', 'requires_refund', 'disputed'])('rejects a previously issued gate QR while its order is %s', async (status) => {
  const suffix = `payment-state-${status}`;
  const { attendeeToken, ticketId } = await seedIssuedTicket(suffix);
  const wallet = await (await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
    method: "POST", headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0], origin: "https://tickets.becoreops.com" },
  }))).json() as { orders: Array<{ tickets: Array<{ gateCode: string }> }> };
  const cookie = await ownerCookie(suffix);
  await env.DB.prepare("UPDATE orders SET status=? WHERE id=?").bind(status, `order-${suffix}`).run();
  const response = await checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
    method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
    body: JSON.stringify({ code: wallet.orders[0].tickets[0].gateCode, eventSlug: "after-dark-osu", gate: "Main gate" }),
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({result:'invalid'});
  expect(await env.DB.prepare("SELECT status FROM tickets WHERE id=?").bind(ticketId).first()).toEqual({status:'issued'});
});

it('excludes unpaid stale tickets from a newly downloaded offline manifest', async () => {
  const suffix = 'manifest-payment-state';
  const { ticketId } = await seedIssuedTicket(suffix);
  const cookie = await ownerCookie(suffix);
  await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(`order-${suffix}`).run();
  const response = await gateManifest(new Request('https://tickets.becoreops.com/api/admin/check-in?eventSlug=after-dark-osu&manifest=1',{headers:{cookie}}));
  expect(response.status).toBe(200);
  const result = await response.json() as {manifest:Array<{ticketId:string}>};
  expect(result.manifest.some(ticket=>ticket.ticketId===ticketId)).toBe(false);
});

it('never reissues a refunded checked-in ticket during supervisor undo', async () => {
  const suffix = 'undo-payment-state';
  const { ticketId } = await seedIssuedTicket(suffix);
  const cookie = await ownerCookie(suffix);
  await env.DB.batch([
    env.DB.prepare("UPDATE tickets SET status='checked_in' WHERE id=?").bind(ticketId),
  ]);
  await recordDisputeWebhook(env.DB, {eventType:'charge.dispute.resolve', reference:`BCT-GATE-${suffix}`,
    payload:{data:{id:`dispute-${suffix}`,resolution:'merchant-accepted',status:'resolved',refund_amount:12900}}});
  expect(await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(`order-${suffix}`).first()).toEqual({status:'refunded'});
  const response = await undoCheckIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
    method: "DELETE", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
    body: JSON.stringify({ ticketId, eventSlug: "after-dark-osu", reason: "Supervisor correction" }),
  }));
  expect(response.status).toBe(409);
  expect(await env.DB.prepare("SELECT status FROM tickets WHERE id=?").bind(ticketId).first()).toEqual({status:'checked_in'});
});


async function readyGate(suffix: string) {
  const { attendeeToken, ticketId } = await seedIssuedTicket(suffix);
  const cookie = await ownerCookie(suffix);
  const wallet = await (await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
    method: "POST", headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0], origin: "https://tickets.becoreops.com" },
  }))).json() as { orders: Array<{ tickets: Array<{ gateCode: string }> }> };
  const clientScanId=crypto.randomUUID();
  const scan=()=>checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
    method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://tickets.becoreops.com" },
    body: JSON.stringify({ code: wallet.orders[0].tickets[0].gateCode, eventSlug: "after-dark-osu", gate: "Main gate", clientScanId }),
  }));
  return {cookie,ticketId,scan};
}

it.each(['rsvp','complimentary'])('admits a valid zero-cost %s booking exactly once',async(provider)=>{
  const suffix=`free-${provider}`, gate=await readyGate(suffix);
  await env.DB.prepare("UPDATE orders SET payment_provider=?,face_amount_minor=0,booking_fee_minor=0,total_amount_minor=0 WHERE id=?").bind(provider,`order-${suffix}`).run();
  expect((await gate.scan()).status).toBe(200);
  expect(await (await gate.scan()).json()).toMatchObject({result:'valid',replayed:true});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id=?").bind(gate.ticketId).first()).toEqual({count:1});
});

it('shows a financially invalid ticket as unavailable in gate search',async()=>{
  const suffix='search-invalid',gate=await readyGate(suffix);
  await env.DB.prepare("UPDATE orders SET status='disputed' WHERE id=?").bind(`order-${suffix}`).run();
  const response=await gateManifest(new Request(`https://tickets.becoreops.com/api/admin/check-in?eventSlug=after-dark-osu&q=BCT-GATE-${suffix}`,{headers:{cookie:gate.cookie}}));
  expect(await response.json()).toMatchObject({matches:[{ticketId:gate.ticketId,status:'unavailable'}]});
});

it.each(['refunded','undo'])('does not replay a successful admission after %s',async(change)=>{
  const suffix=`replay-invalid-${change}`,gate=await readyGate(suffix);
  expect((await gate.scan()).status).toBe(200);
  if(change==='refunded')await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(`order-${suffix}`).run();
  else expect((await undoCheckIn(new Request("https://tickets.becoreops.com/api/admin/check-in",{
    method:'DELETE',headers:{cookie:gate.cookie,origin:'https://tickets.becoreops.com','content-type':'application/json'},
    body:JSON.stringify({ticketId:gate.ticketId,eventSlug:'after-dark-osu',reason:'Correction'})}))).status).toBe(200);
  const response=await gate.scan();expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({result:'invalid'});
});

it('fails closed when the payment changes between the ticket read and conditional admission',async()=>{
  const suffix='race-payment',gate=await readyGate(suffix);
  const original=env.DB.prepare.bind(env.DB);
  const prepare=vi.spyOn(env.DB,'prepare').mockImplementation((sql:string)=>{
    const statement=original(sql);
    if(sql.includes("WHERE t.qr_token_hash = ?")){
      const bind=statement.bind.bind(statement);
      statement.bind=(...values:unknown[])=>{
        const bound=bind(...values),first=bound.first.bind(bound);
        bound.first=async <T>(column?: string)=>{const row=await (column===undefined?first<T>():first<T>(column));await original("UPDATE orders SET status='refunded' WHERE id=?").bind(`order-${suffix}`).run();return row;};
        return bound;
      };
    }
    return statement;
  });
  let response:Response;
  try {response=await gate.scan();} finally {prepare.mockRestore();}
  expect(response!.status).toBe(409);expect(await response!.json()).toMatchObject({result:'invalid'});
  expect(await env.DB.prepare("SELECT status FROM tickets WHERE id=?").bind(gate.ticketId).first()).toEqual({status:'issued'});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id=?").bind(gate.ticketId).first()).toEqual({count:0});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_audit_events WHERE target_id=?").bind(gate.ticketId).first()).toEqual({count:0});
});


it.each([['check_in','gate_checkin_events'],['undo','gate_checkin_events'],['check_in','operational_audit_events'],['undo','operational_audit_events']])('rolls back %s if %s cannot be recorded',async(action,table)=>{
  const suffix=`atomic-receipt-${action}-${table}`,gate=await readyGate(suffix);
  if(action==='undo')expect((await gate.scan()).status).toBe(200);
  const recordedAction=table==='gate_checkin_events'?action:action==='check_in'?'gate.ticket_checked_in':'gate.ticket_checkin_undone';
  await env.DB.exec(`CREATE TRIGGER audit_gate_receipt_failure BEFORE INSERT ON ${table} WHEN NEW.action='${recordedAction}' BEGIN SELECT RAISE(ABORT, 'receipt fixture failure'); END`);
  try {
    const request=action==='check_in'?gate.scan():undoCheckIn(new Request("https://tickets.becoreops.com/api/admin/check-in",{
      method:'DELETE',headers:{cookie:gate.cookie,origin:'https://tickets.becoreops.com','content-type':'application/json'},
      body:JSON.stringify({ticketId:gate.ticketId,eventSlug:'after-dark-osu',reason:'Correction'})}));
    await expect(request).rejects.toThrow('receipt fixture failure');
  } finally { await env.DB.exec('DROP TRIGGER audit_gate_receipt_failure'); }
  expect(await env.DB.prepare("SELECT status FROM tickets WHERE id=?").bind(gate.ticketId).first()).toEqual({status:action==='check_in'?'issued':'checked_in'});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id=?").bind(gate.ticketId).first()).toEqual({count:action==='check_in'?0:1});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_audit_events WHERE target_id=?").bind(gate.ticketId).first()).toEqual({count:action==='check_in'?0:1});
});


it('records an Apple Wallet-backed admission successfully while its update triggers run',async()=>{
  const suffix='wallet-gate',gate=await readyGate(suffix),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO apple_wallet_passes (id,ticket_id,attendee_id,event_slug,pass_type_identifier,serial_number,created_at,updated_at) VALUES (?,?,?,'after-dark-osu','pass.example.gate',?,?,?)")
    .bind(suffix,gate.ticketId,`attendee-${suffix}`,suffix,now,now).run();
  const response=await gate.scan();expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({result:'valid'});
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id=?").bind(gate.ticketId).first()).toEqual({count:1});
  expect((await undoCheckIn(new Request("https://tickets.becoreops.com/api/admin/check-in",{
    method:'DELETE',headers:{cookie:gate.cookie,origin:'https://tickets.becoreops.com','content-type':'application/json'},
    body:JSON.stringify({ticketId:gate.ticketId,eventSlug:'after-dark-osu',reason:'Correction'})}))).status).toBe(200);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM gate_checkin_events WHERE ticket_id=?").bind(gate.ticketId).first()).toEqual({count:2});
});
