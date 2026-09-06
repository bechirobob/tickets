import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET, POST, PATCH } from "../app/api/rooms/[slug]/flashes/[id]/route";
import { GET as listFlashes } from "../app/api/rooms/[slug]/flashes/route";
import { hashToken } from "../lib/attendee-auth";

const origin = "https://tickets.becoreops.com";
const slug = "after-dark-osu";

async function guest(name: string) {
  const id = crypto.randomUUID(); const token = crypto.randomUUID();
  const now = new Date().toISOString(); const future = new Date(Date.now() + 3_600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(id, `${id}@example.com`, name, now, now),
    env.DB.prepare("INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`session:${id}`, id, await hashToken(token), future, now, now),
    env.DB.prepare("INSERT INTO orders (id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, created_at, paid_at) VALUES (?, ?, ?, 1, 12000, 0, 12000, 'GHS', ?, '233000000000', 'mobile_money:mtn', 'paid', ?, ?)").bind(`order:${id}`, `ref:${id}`, slug, `${id}@example.com`, now, now),
    env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', ?, 'issued', ?)").bind(`ticket:${id}`, `order:${id}`, slug, `qr:${id}`, now),
    env.DB.prepare("INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)").bind(`ticket:${id}`, id, `order:${id}`, now),
  ]);
  return { id, cookie: `bct_attendee=${token}` };
}
async function fixture() {
  const owner = await guest("Ama"); const recipient = await guest("Kofi");
  const id = crypto.randomUUID();
  const now = new Date().toISOString(); const future = new Date(Date.now() + 3_600_000).toISOString();
  await env.DB.prepare("UPDATE curated_event_records SET starts_at = ?, ends_at = ? WHERE slug = ?").bind(now, future, slug).run();
  await env.DB.prepare("INSERT INTO room_flashes (id, event_slug, attendee_id, image_data, content_type, width, height, byte_size, status, moderation_result, created_at, expires_at) VALUES (?, ?, ?, ?, 'image/webp', 1, 1, 3, 'active', 'allowed', ?, ?)").bind(id, slug, owner.id, new Uint8Array([1, 2, 3]), now, future).run();
  const context = { params: Promise.resolve({ slug, id }) };
  const url = `${origin}/api/rooms/${slug}/flashes/${id}`;
  const request = (cookie: string, method = "POST", viewId = crypto.randomUUID(), source = origin) => new Request(url, { method, headers: { origin: source, cookie, "content-type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify({ viewId }) } : {}) });
  return { owner, recipient, id, context, url, request };
}

describe("Flash viewing sessions", () => {
  it("does not expose image bytes or consume a Flash until the guest opens it", async () => {
    const f = await fixture();
    expect((await GET(f.request(f.recipient.cookie, "GET"), f.context)).status).toBe(410);
    const list = await listFlashes(new Request(`${origin}/api/rooms/${slug}/flashes`, { headers: { cookie: f.recipient.cookie } }), { params: Promise.resolve({ slug }) });
    expect((await list.json() as { flashes: { id: string; openedAt: null }[] }).flashes.find((item) => item.id === f.id)?.openedAt).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM room_flash_views WHERE flash_id = ?").bind(f.id).first<{ count: number }>())?.count).toBe(0);
  });

  it("admits one concurrent recipient session and retries without extending its deadline", async () => {
    const f = await fixture(); const first = crypto.randomUUID(); const second = crypto.randomUUID();
    const responses = await Promise.all([POST(f.request(f.recipient.cookie, "POST", first), f.context), POST(f.request(f.recipient.cookie, "POST", second), f.context)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 410]);
    const winning = responses[0].status === 200 ? first : second;
    const lease = await responses.find((response) => response.status === 200)!.json() as { imageUrl: string; remainingMs: number };
    expect(lease.remainingMs).toBeGreaterThan(0); expect(lease.remainingMs).toBeLessThanOrEqual(10_000);
    const original = await env.DB.prepare("SELECT view_until FROM room_flash_views WHERE flash_id = ? AND attendee_id = ?").bind(f.id, f.recipient.id).first();
    const retry = await POST(f.request(f.recipient.cookie, "POST", winning), f.context);
    expect(retry.status).toBe(200);
    expect(await env.DB.prepare("SELECT view_until FROM room_flash_views WHERE flash_id = ? AND attendee_id = ?").bind(f.id, f.recipient.id).first()).toEqual(original);
    const photo = await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context);
    expect(photo.status).toBe(200); expect(photo.headers.get("cache-control")).toContain("no-store");
    expect([...new Uint8Array(await photo.arrayBuffer())]).toEqual([1, 2, 3]);
    const list = await listFlashes(new Request(`${origin}/api/rooms/${slug}/flashes`, { headers: { cookie: f.recipient.cookie } }), { params: Promise.resolve({ slug }) });
    expect((await list.json() as { flashes: { id: string; openedAt: string }[] }).flashes.find((item) => item.id === f.id)?.openedAt).toEqual(expect.any(String));
  });

  it("isolates guests and ends image access when a session closes", async () => {
    const f = await fixture(); const other = await guest("Yaw"); const nonce = crypto.randomUUID();
    const lease = await (await POST(f.request(f.recipient.cookie, "POST", nonce), f.context)).json() as { imageUrl: string };
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: other.cookie } }), f.context)).status).toBe(410);
    expect((await POST(f.request(other.cookie), f.context)).status).toBe(200);
    expect((await PATCH(f.request(f.recipient.cookie, "PATCH", nonce), f.context)).status).toBe(200);
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(410);
    expect((await POST(f.request(f.recipient.cookie, "POST", nonce), f.context)).status).toBe(410);
    expect((await POST(f.request(f.recipient.cookie), f.context)).status).toBe(410);
  });

  it("rejects expired sessions, unsigned guests, bad origins and cross-guest closure", async () => {
    const f = await fixture(); const nonce = crypto.randomUUID();
    expect((await POST(f.request(""), f.context)).status).toBe(401);
    expect((await POST(f.request(f.recipient.cookie, "POST", nonce, "https://untrusted.example"), f.context)).status).toBe(403);
    const lease = await (await POST(f.request(f.recipient.cookie, "POST", nonce), f.context)).json() as { imageUrl: string };
    await PATCH(f.request(f.owner.cookie, "PATCH", nonce), f.context);
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(200);
    await env.DB.prepare("UPDATE room_flash_views SET view_until = ? WHERE flash_id = ?").bind(new Date(Date.now() - 1000).toISOString(), f.id).run();
    expect((await POST(f.request(f.recipient.cookie, "POST", nonce), f.context)).status).toBe(410);
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(410);
  });

  it("keeps owner previews separate and revokes access for hidden or closed Rooms", async () => {
    const f = await fixture(); const nonce = crypto.randomUUID();
    expect((await POST(f.request(f.owner.cookie, "POST", nonce), f.context)).status).toBe(200);
    await PATCH(f.request(f.owner.cookie, "PATCH", nonce), f.context);
    expect((await POST(f.request(f.owner.cookie), f.context)).status).toBe(200);
    const lease = await (await POST(f.request(f.recipient.cookie), f.context)).json() as { imageUrl: string };
    await env.DB.prepare("UPDATE room_flashes SET status = 'hidden' WHERE id = ?").bind(f.id).run();
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(404);
    await env.DB.prepare("UPDATE room_flashes SET status = 'active' WHERE id = ?").bind(f.id).run();
    await env.DB.prepare("UPDATE curated_event_records SET ends_at = ? WHERE slug = ?").bind(new Date(Date.now() - 96 * 3_600_000).toISOString(), slug).run();
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(410);
  });

  it("applies personal blocks and reports before claiming or serving media", async () => {
    const f = await fixture();
    await env.DB.prepare("INSERT INTO room_blocks (id, event_slug, blocker_attendee_id, blocked_attendee_id, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), slug, f.recipient.id, f.owner.id, new Date().toISOString()).run();
    expect((await POST(f.request(f.recipient.cookie), f.context)).status).toBe(410);
    await env.DB.prepare("DELETE FROM room_blocks WHERE blocker_attendee_id = ?").bind(f.recipient.id).run();
    const lease = await (await POST(f.request(f.recipient.cookie), f.context)).json() as { imageUrl: string };
    await env.DB.prepare("INSERT INTO room_flash_reports (id, flash_id, event_slug, reporter_attendee_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'nonconsensual', 'open', ?)").bind(crypto.randomUUID(), f.id, slug, f.recipient.id, new Date().toISOString()).run();
    expect((await GET(new Request(origin + lease.imageUrl, { headers: { cookie: f.recipient.cookie } }), f.context)).status).toBe(404);
  });
});
