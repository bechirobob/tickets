import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { POST as initializePayment } from "../app/api/payments/initialize/route";
import { refreshExpiredPreviewEvents } from "../lib/preview-events";
import { GET as bookingFeeQuote } from "../app/api/config/booking-fee/route";
import { findCuratedEvent, getPublicEvents } from "../app/events";
import { discoveryFaceMinor } from "../lib/event-pricing";

const eventSlug = "inventory-payment-test";

function paymentRequest(slug: string, ticketTierId: string, quantity = 1, network = "mtn", paymentMethod: "mobile_money" | "card" = "mobile_money") {
  return new Request("https://tickets.becoreops.com/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://tickets.becoreops.com" },
    body: JSON.stringify({ eventSlug: slug, ticketTierId, quantity, email: "buyer@example.com", phone: "233000000000", fullName: "Ticket Buyer", paymentMethod, network: paymentMethod === "mobile_money" ? network : undefined, acceptedPolicies: true }),
  });
}

beforeAll(async () => {
  await refreshExpiredPreviewEvents(env.DB);
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + 6 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO curated_event_records (
        id, submission_id, slug, title, venue, venue_map_url, area, starts_at, ends_at,
        vibe, price_from_minor, capacity, sales_open_at, sales_close_at,
        age_restriction, lineup, event_state, image_url, curation_note, status,
        published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'on_sale', ?, ?, 'published', ?, ?, ?)
    `).bind("payment-event", "payment-submission", eventSlug, "Inventory Payment Test", "Test Venue", "https://maps.google.com/?q=Test+Venue", "Accra", startsAt, endsAt, "Late night", 12_000, 200, now, startsAt, "18+", "Test DJ", "https://example.com/test.jpg", "A real database event used to verify payment selection behavior.", now, now, now),
    ...[
      ["general", "General admission", 12_000, 1, 100, 10],
      ["vip", "VIP", 25_000, 1, 50, 10],
      ["table-for-5", "Table for 5", 180_000, 5, 50, 2],
      ["last-two", "Last two", 12_000, 1, 2, 1],
    ].map(([code, name, price, admissions, capacity, limit], index) => env.DB.prepare(`
      INSERT INTO event_ticket_tiers (
        id, event_slug, code, name, description, price_minor, admissions_per_unit,
        capacity_admissions, max_units_per_order, status, sales_open_at, sales_close_at,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Test tier', ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?)
    `).bind(`payment-tier-${code}`, eventSlug, code, name, price, admissions, capacity, limit, now, startsAt, index, now, now)),
  ]);
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { reference?: string };
    if (String(url).endsWith("/transaction/initialize")) {
      return Response.json({ status: true, message: "Authorization URL created", data: { reference: body.reference, authorization_url: "https://checkout.paystack.com/test-session" } });
    }
    return Response.json({ status: true, message: "Charge attempted", data: { reference: body.reference, status: "pay_offline", display_text: "Approve the prompt on your phone" } });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("payment ticket validation", () => {
  it("replays the original payment without a second reservation or provider call", async () => {
    const request = paymentRequest(eventSlug, "general");
    request.headers.set("idempotency-key", crypto.randomUUID());
    const first = await initializePayment(request.clone() as Request);
    const replay = await initializePayment(request.clone() as Request);
    expect(first.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const changed = await request.json() as Record<string, unknown>;
    changed.quantity = 2;
    expect((await initializePayment(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(changed) }))).status).toBe(409);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("serializes simultaneous attempts sharing an idempotency key", async () => {
    const request = paymentRequest(eventSlug, "general");
    request.headers.set("idempotency-key", crypto.randomUUID());
    const responses = await Promise.all([initializePayment(request.clone() as Request), initializePayment(request.clone() as Request)]);
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous provider outcome pending and safe to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network failure"); }));
    const request = paymentRequest(eventSlug, "general");
    request.headers.set("idempotency-key", crypto.randomUUID());
    const response = await initializePayment(request.clone() as Request);
    expect(response.status).toBe(202);
    const data = await response.json() as { reference: string; nextUrl: string };
    expect(data.nextUrl).toContain("pending=1");
    expect(await env.DB.prepare("SELECT status FROM orders WHERE reference = ?").bind(data.reference).first()).toMatchObject({ status: "payment_pending" });
    expect(await env.DB.prepare("SELECT r.status FROM inventory_reservations r JOIN orders o ON o.id = r.order_id WHERE o.reference = ?").bind(data.reference).first()).toMatchObject({ status: "held" });
    expect((await initializePayment(request.clone() as Request)).status).toBe(202);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON and wrong-type fields without starting payment", async () => {
    for (const body of ["{", "null", "[]", JSON.stringify({ acceptedPolicies: true, eventSlug: 42 }), JSON.stringify({ acceptedPolicies: true, email: {} })]) {
      const request = paymentRequest(eventSlug, "general");
      expect((await initializePayment(new Request(request.url, { method: "POST", headers: request.headers, body }))).status).toBe(400);
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each(["invalid-json", "upstream-503"])("keeps %s responses pending instead of asserting no charge", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(failure === "invalid-json" ? "not JSON" : "Unavailable", { status: failure === "invalid-json" ? 200 : 503 })));
    const response = await initializePayment(paymentRequest(eventSlug, "general"));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ pending: true });
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not reopen an expired reservation when the original key is replayed", async () => {
    const request = paymentRequest(eventSlug, "general");
    request.headers.set("idempotency-key", crypto.randomUUID());
    const first = await (await initializePayment(request.clone() as Request)).json() as { reference: string };
    await env.DB.prepare("UPDATE orders SET reservation_expires_at = '2020-01-01' WHERE reference = ?").bind(first.reference).run();
    expect((await initializePayment(request.clone() as Request)).status).toBe(410);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("quotes the event-specific fee and refuses a changed checkout total", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO booking_fee_rules (id, scope, scope_id, percentage_basis_points, effective_at, created_at, created_by) VALUES (?, 'event', ?, 1100, '2020-01-01', ?, 'test')").bind(id, eventSlug, new Date().toISOString()).run();
    const quote = await bookingFeeQuote(new Request(`https://tickets.becoreops.com/api/config/booking-fee?event=${eventSlug}`));
    expect(await quote.json()).toMatchObject({ percentage: 11 });
    const advertised = await findCuratedEvent(eventSlug);
    expect(advertised?.bookingFeeBasisPoints).toBe(1100);
    expect(discoveryFaceMinor(advertised!)).toBe(12000);
    expect((await getPublicEvents()).find((event) => event.slug === eventSlug)?.bookingFeeBasisPoints).toBe(1100);
    const request = paymentRequest(eventSlug, "general");
    const body = await request.json() as Record<string, unknown>;
    body.expectedTotalMinor = 12000;
    const response = await initializePayment(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ feeBasisPoints: 1100, retryable: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    await env.DB.prepare("DELETE FROM booking_fee_rules WHERE id = ?").bind(id).run();
  });
  it("accepts every database-backed advertised tier and initializes the provider", async () => {
    for (const tier of ["general", "vip", "table-for-5"]) {
      const response = await initializePayment(paymentRequest(eventSlug, tier));
      expect(response.status, tier).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ nextUrl: expect.stringMatching(/^\/payment\/return\?/u), displayText: "Approve the prompt on your phone" });
    }
  });

  it("uses Paystack's direct Ghana MoMo provider codes for live events", async () => {
    for (const [network, provider] of [["mtn", "mtn"], ["telecel", "vod"], ["at", "atl"]] as const) {
      const response = await initializePayment(paymentRequest(eventSlug, "general", 1, network));
      expect(response.status).toBe(200);
      const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
      const body = JSON.parse(String(init?.body)) as { mobile_money: { phone: string; provider: string }; currency: string };
      expect(String(url)).toBe("https://api.paystack.co/charge");
      expect(body).toMatchObject({ currency: "GHS", mobile_money: { phone: "233000000000", provider } });
      await expect(response.json()).resolves.toMatchObject({ nextUrl: expect.not.stringContaining("checkout.paystack") });
    }
  });

  it("uses Paystack hosted checkout for card payments without collecting card details", async () => {
    const response = await initializePayment(paymentRequest(eventSlug, "general", 1, "mtn", "card"));
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    const body = JSON.parse(String(init?.body)) as { reference: string; channels: string[]; callback_url: string; metadata: string; mobile_money?: unknown };
    expect(String(url)).toBe("https://api.paystack.co/transaction/initialize");
    expect(body.channels).toEqual(["card"]);
    expect(body.mobile_money).toBeUndefined();
    expect(body.callback_url).toMatch(/^https:\/\/tickets\.becoreops\.com\/payment\/return\?/u);
    expect(JSON.parse(body.metadata)).toMatchObject({ eventSlug, paymentMethod: "card" });
    await expect(response.json()).resolves.toMatchObject({ authorizationUrl: "https://checkout.paystack.com/test-session" });
    const order = await env.DB.prepare("SELECT payment_channel AS paymentChannel FROM orders WHERE reference = ?")
      .bind(body.reference).first<{ paymentChannel: string }>();
    expect(order?.paymentChannel).toBe("card");
  });

  it("uses Paystack hosted checkout so test events can complete visibly", async () => {
    const response = await initializePayment(paymentRequest("after-dark-osu", "general", 1, "mtn"));
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    const body = JSON.parse(String(init?.body)) as { channels: string[]; callback_url: string; metadata: string };
    expect(String(url)).toBe("https://api.paystack.co/transaction/initialize");
    expect(body.channels).toEqual(["mobile_money"]);
    expect(body.callback_url).toMatch(/^https:\/\/tickets\.becoreops\.com\/payment\/return\?/u);
    expect(JSON.parse(body.metadata)).toMatchObject({ eventSlug: "after-dark-osu", network: "mtn" });
    await expect(response.json()).resolves.toMatchObject({ authorizationUrl: "https://checkout.paystack.com/test-session" });
  });

  it("rejects unknown events and ticket tiers", async () => {
    expect((await initializePayment(paymentRequest("not-a-real-event", "general"))).status).toBe(400);
    expect((await initializePayment(paymentRequest(eventSlug, "backstage"))).status).toBe(400);
  });

  it("rejects unknown payment methods", async () => {
    const request = paymentRequest(eventSlug, "general");
    const body = await request.json() as Record<string, unknown>;
    body.paymentMethod = "cash";
    const response = await initializePayment(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Choose mobile money or card payment." });
  });

  it("keeps already-open General Admission checkouts compatible during deployment", async () => {
    const request = paymentRequest(eventSlug, "general");
    const body = await request.json() as Record<string, unknown>;
    delete body.ticketTierId;
    const response = await initializePayment(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
  });

  it("atomically prevents three buyers from reserving the last two admissions", async () => {
    const responses = await Promise.all([
      initializePayment(paymentRequest(eventSlug, "last-two")),
      initializePayment(paymentRequest(eventSlug, "last-two")),
      initializePayment(paymentRequest(eventSlug, "last-two")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 409]);
    const allocated = await env.DB.prepare(`
      SELECT COALESCE(SUM(admission_count), 0) AS count
      FROM inventory_reservations reservation
      JOIN event_ticket_tiers tier ON tier.id = reservation.ticket_tier_id
      WHERE tier.event_slug = ? AND tier.code = 'last-two' AND reservation.status = 'held'
    `).bind(eventSlug).first<{ count: number }>();
    expect(allocated?.count).toBe(2);
  });
});
