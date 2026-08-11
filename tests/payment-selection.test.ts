import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { POST as initializePayment } from "../app/api/payments/initialize/route";

const eventSlug = "inventory-payment-test";

function paymentRequest(slug: string, ticketTierId: string, quantity = 1, network = "mtn") {
  return new Request("https://tickets.becoreops.com/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://tickets.becoreops.com" },
    body: JSON.stringify({ eventSlug: slug, ticketTierId, quantity, email: "buyer@example.com", phone: "233000000000", fullName: "Ticket Buyer", network }),
  });
}

beforeAll(async () => {
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
  vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { reference?: string };
    return Response.json({ status: true, message: "Charge attempted", data: { reference: body.reference, status: "pay_offline", display_text: "Approve the prompt on your phone" } });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("payment ticket validation", () => {
  it("accepts every database-backed advertised tier and initializes the provider", async () => {
    for (const tier of ["general", "vip", "table-for-5"]) {
      const response = await initializePayment(paymentRequest(eventSlug, tier));
      expect(response.status, tier).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ nextUrl: expect.stringMatching(/^\/payment\/return\?/u), displayText: "Approve the prompt on your phone" });
    }
  });

  it("uses Paystack's direct Ghana MoMo provider codes without hosted checkout", async () => {
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

  it("rejects unknown events and ticket tiers", async () => {
    expect((await initializePayment(paymentRequest("not-a-real-event", "general"))).status).toBe(400);
    expect((await initializePayment(paymentRequest(eventSlug, "backstage"))).status).toBe(400);
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
