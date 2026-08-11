import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as getMyNights } from "../app/api/customer/my-nights/route";
import { GET as getPreferences, POST as savePreference } from "../app/api/customer/preferences/route";
import { GET as getExperience, PATCH as saveExperience } from "../app/api/customer/experience/[slug]/route";
import { GET as getPrivacy, PUT as savePrivacy } from "../app/api/customer/privacy/route";
import { hashToken } from "../lib/attendee-auth";

const origin = "https://tickets.becoreops.com";
const eventSlug = "after-dark-osu";

async function memberCookie() {
  const suffix = crypto.randomUUID();
  const attendeeId = `attendee:${suffix}`;
  const sessionToken = `session-${suffix}-with-a-long-secure-value`;
  const orderId = `order:${suffix}`;
  const ticketId = `ticket:${suffix}`;
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, status, created_at, updated_at) VALUES (?, ?, 'Test Member', 'active', ?, ?)").bind(attendeeId, `${suffix}@example.com`, now, now),
    env.DB.prepare("INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`session:${suffix}`, attendeeId, await hashToken(sessionToken), future, now, now),
    env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, created_at, paid_at) VALUES (?, ?, ?, 1, 12000, 0, 12000, 'GHS', ?, '233000000000', 'mobile_money:mtn', 'paid', ?, ?)`)
      .bind(orderId, `BCT-${suffix}`, eventSlug, `${suffix}@example.com`, now, now),
    env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', ?, 'issued', ?)").bind(ticketId, orderId, eventSlug, `qr:${suffix}`, now),
    env.DB.prepare("INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)").bind(ticketId, attendeeId, orderId, now),
  ]);
  return `bct_attendee=${sessionToken}`;
}

function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${origin}${path}`, { ...init, headers });
}

describe("ticket-earned member experience", () => {
  it("keeps every member and event-specific surface closed without a paid attendee session", async () => {
    const context = { params: Promise.resolve({ slug: eventSlug }) };
    expect((await getMyNights(request("/api/customer/my-nights"))).status).toBe(401);
    expect((await getPreferences(request(`/api/customer/preferences?event=${eventSlug}`))).status).toBe(401);
    expect((await getExperience(request(`/api/customer/experience/${eventSlug}`), context)).status).toBe(401);
    expect((await getPrivacy(request("/api/customer/privacy"))).status).toBe(401);
  });

  it("unlocks follows globally and ticket features only for the purchased event", async () => {
    const cookie = await memberCookie();
    const context = { params: Promise.resolve({ slug: eventSlug }) };
    const preferenceResponse = await savePreference(request("/api/customer/preferences", cookie, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ eventSlug, keepPosted: true }),
    }));
    expect(preferenceResponse.status).toBe(200);

    const initialResponse = await getExperience(request(`/api/customer/experience/${eventSlug}`, cookie), context);
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as { questions: Array<{ id: string }>; updates: Array<{ title: string }> };
    expect(initial.questions).toHaveLength(2);
    expect(initial.updates[0]?.title).toBe("Your night is ready");

    const saveResponse = await saveExperience(request(`/api/customer/experience/${eventSlug}`, cookie, {
      method: "PATCH",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ attendeeVisible: true, keepPosted: true, answers: [{ questionId: initial.questions[0]?.id, answer: "At doors" }] }),
    }), context);
    expect(saveResponse.status).toBe(200);

    const nightsResponse = await getMyNights(request("/api/customer/my-nights", cookie));
    expect(nightsResponse.status).toBe(200);
    const nights = await nightsResponse.json() as { nights: Array<{ eventSlug: string; purchased: boolean; attendeeVisible: boolean; keepPosted: boolean }> };
    expect(nights.nights).toContainEqual(expect.objectContaining({ eventSlug, purchased: true, attendeeVisible: true, keepPosted: true }));
  });

  it("stores private-by-default account choices behind the member session", async () => {
    const cookie = await memberCookie();
    const saveResponse = await savePrivacy(request("/api/customer/privacy", cookie, {
      method: "PUT",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ defaultAttendeeVisible: false, allowHostUpdates: true }),
    }));
    expect(saveResponse.status).toBe(200);
    const response = await getPrivacy(request("/api/customer/privacy", cookie));
    expect(await response.json()).toMatchObject({ defaultAttendeeVisible: false, allowHostUpdates: true });
  });
});
