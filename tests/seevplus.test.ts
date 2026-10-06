import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as initialize } from "../app/api/payments/initialize/route";
import { POST as webhook } from "../app/api/payments/seevplus/webhook/route";
import { POST as claimTickets } from "../app/api/customer/session/route";
import { createSeevCheckout, recoverSeevPayment, recoverSeevPayments, seevAvailable, seevCryptoAvailable, validSeevCheckoutUrl, verifySeevPayment } from "../lib/seevplus";
import { expireReservations, fulfillVerifiedPayment, initiatePaystackRefund, runDailyReconciliation } from "../lib/payment-operations";
import { recoverAbandonedPayments } from "../lib/sales-recovery";
import { hashToken } from "../lib/attendee-auth";

const runtime = env as unknown as Cloudflare.Env;
const api = "https://api.seevplus.com/api/v1/developer/payments";
const origin = "https://tickets.becoreops.com";
let createBody: { amount: number; currency: string; redirect_url: string; meta: { orderId: string }; recipient: { name: string }; channels: string[]; subaccount?: string; network?: string };
let verifyOverrides: Record<string, unknown>;
let createOverrides: Record<string, unknown>;
let providerReference: string;
let slug: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  runtime.SEEV_ENABLED = "true";
  runtime.SEEV_CRYPTO_ENABLED = "false";
  runtime.SEEV_ENVIRONMENT = "sandbox";
  runtime.SEEV_CHECKOUT_API_KEY = "test-only-seev-key";
  runtime.SEEV_WEBHOOK_SECRET = "test-only-seev-signing-secret";
  verifyOverrides = {};
  createOverrides = {};
  providerReference = `PAY-${crypto.randomUUID()}`;
  slug = `seev-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records (id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe, price_from_minor, capacity, event_state, image_url, curation_note, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, 'Seev Test', 'Test Venue', 'Accra', ?, ?, 'Late night', 10000, 20, 'on_sale', 'https://example.com/test.jpg', 'An event for payment integration testing.', 'published', ?, ?, ?)`)
      .bind(slug, slug, slug, future, future, now, now, now),
    env.DB.prepare(`INSERT INTO event_ticket_tiers (id, event_slug, code, name, description, price_minor, admissions_per_unit, capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at)
      VALUES (?, ?, 'general', 'General', 'One admission', 10000, 1, 20, 10, 'available', 0, ?, ?)`)
      .bind(slug, slug, now, now),
  ]);
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === api) {
      createBody = JSON.parse(String(init?.body));
      return Response.json({ success: true, data: { reference: providerReference, checkout_url: `https://pay.seevplus.com/${providerReference}`, amount: createBody.amount, currency: "GHS", env: "sandbox", ...createOverrides } }, { status: 201 });
    }
    if (String(url).startsWith(`${api}/`)) return Response.json({ success: true, data: { id: "seev-session-id", reference: providerReference, status: "completed", amount: createBody.amount, final_amount: createBody.amount, currency: "GHS", env: "sandbox", ...verifyOverrides } });
    if (String(url) === "https://api.resend.com/emails") return Response.json({ id: crypto.randomUUID() });
    if (String(url).startsWith("https://api.paystack.co/transaction?")) return Response.json({ status: true, data: [] });
    throw new Error(`Unexpected provider call: ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete runtime.SEEV_ENABLED;
  delete runtime.SEEV_CRYPTO_ENABLED;
  delete runtime.SEEV_ENVIRONMENT;
  delete runtime.SEEV_CHECKOUT_API_KEY;
  delete runtime.SEEV_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
});

function request(overrides: Record<string, unknown> = {}, key = crypto.randomUUID()) {
  return new Request(`${origin}/api/payments/initialize`, { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ eventSlug: slug, ticketTierId: "general", quantity: 2, fullName: "Seev Buyer", email: "seev@example.com", phone: "0240000000", paymentMethod: "mobile_money", paymentProvider: "seevplus", network: "mtn", acceptedPolicies: true, ...overrides }) });
}
async function checkout() {
  const response = await initialize(request());
  expect(response.status).toBe(200);
  return await response.json() as { reference: string; authorizationUrl: string };
}
async function order(reference: string) {
  return env.DB.prepare("SELECT id, status, payment_provider, provider_reference, paystack_reference FROM orders WHERE reference = ?").bind(reference).first<{ id: string; status: string; payment_provider: string; provider_reference: string | null; paystack_reference: string | null }>();
}
async function ticketCount(reference: string) {
  return (await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets JOIN orders ON orders.id = tickets.order_id WHERE orders.reference = ?").bind(reference).first<{ count: number }>())!.count;
}
async function signedWebhook(overrides: Record<string, unknown> = {}, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify({ event: "payment.succeeded", env: "sandbox", data: { transaction: { reference: providerReference, env: "sandbox", amount: createBody.amount / 100, status: "completed" } }, ...overrides });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(runtime.SEEV_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const signature = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`${origin}/api/payments/seevplus/webhook`, { method: "POST", body: raw, headers: { "x-seev-timestamp": String(timestamp), "x-seev-signature": `v1=${signature}` } });
}

describe("SeevPlus checkout and payment safety", () => {
  it("rejects an email above 254 characters before claiming an attempt or reserving inventory", async () => {
    const key = crypto.randomUUID(), email = `${"a".repeat(243)}@example.com`;
    expect(email).toHaveLength(255);
    expect((await initialize(request({ email, platformAnnouncementsOptIn: true }, key))).status).toBe(400);
    expect(await env.DB.prepare("SELECT order_id FROM payment_attempts WHERE key_hash = ?").bind(await hashToken(key)).first()).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug = ?").bind(slug).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE event_slug = ?").bind(slug).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT email FROM platform_announcement_choices WHERE email = ?").bind(email).first()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays legacy checkout hashes with absent or false platform choice, but rejects changing that choice to true", async () => {
    const key = crypto.randomUUID(), req = request({}, key), body = await req.clone().json() as { eventSlug: string; ticketTierId?: string; quantity: number; email: string; phone: string; paymentMethod?: string; network?: string; fullName?: string; offer?: string; promoterCode?: string; acceptedPolicies?: boolean; expectedTotalMinor?: number; paymentProvider?: string; announcementsOptIn?: boolean; couponCode?: string };
    // The pre-platform-consent serialization must remain byte-for-byte stable.
    const legacyHash = await hashToken(JSON.stringify([
      body.eventSlug, body.ticketTierId ?? "general", body.quantity, body.email?.trim().toLowerCase(),
      body.phone?.replace(/[^\d+]/gu, ""), body.paymentMethod ?? "mobile_money", body.network, body.fullName?.trim(),
      body.offer, body.promoterCode, body.acceptedPolicies, body.expectedTotalMinor, body.paymentProvider ?? "paystack",
      body.announcementsOptIn === true, body.couponCode?.trim().toUpperCase() ?? "",
    ]));
    const payload = { authorizationUrl: "https://pay.seevplus.com/PAY-legacy-test", reference: "BCT-LEGACY-TEST" };
    await env.DB.prepare(`INSERT INTO payment_attempts (key_hash, request_hash, order_id, created_at, response_json, response_status)
      VALUES (?, ?, ?, ?, ?, 200)`).bind(await hashToken(key), legacyHash, crypto.randomUUID(), new Date().toISOString(), JSON.stringify(payload)).run();
    for (const changes of [{}, { platformAnnouncementsOptIn: false }]) {
      const replay = await initialize(request(changes, key));
      expect(replay.status).toBe(200);
      expect(replay.headers.get("idempotency-replayed")).toBe("true");
      expect(await replay.json()).toEqual(payload);
    }
    expect((await initialize(request({ platformAnnouncementsOptIn: true }, key))).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug = ?").bind(slug).first()).toEqual({ count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const freshKey = crypto.randomUUID();
    expect((await initialize(request({ platformAnnouncementsOptIn: true }, freshKey))).status).toBe(200);
    const freshAttempt = await env.DB.prepare("SELECT request_hash AS requestHash FROM payment_attempts WHERE key_hash = ?").bind(await hashToken(freshKey)).first<{ requestHash: string }>();
    expect(freshAttempt?.requestHash).not.toBe(legacyHash);
    expect((await initialize(request({ platformAnnouncementsOptIn: true }, freshKey))).headers.get("idempotency-replayed")).toBe("true");
    expect((await initialize(request({ platformAnnouncementsOptIn: false }, freshKey))).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is disabled by default and isolates test payments from public live events", async () => {
    const config = { ...runtime, ENVIRONMENT: "production" };
    expect(seevAvailable({ ...config, SEEV_ENABLED: undefined }, true)).toBe(false);
    expect(seevAvailable(config, false)).toBe(false);
    expect(seevAvailable(config, true)).toBe(true);
    expect(seevAvailable({ ...config, SEEV_ENVIRONMENT: "production" }, true)).toBe(false);
    expect(seevAvailable({ ...config, SEEV_WEBHOOK_SECRET: undefined }, true)).toBe(false);
    expect(seevAvailable({ ...config, SEEV_WEBHOOK_SECRET: undefined, SEEV_ENVIRONMENT: "production" }, false)).toBe(false);
    expect(seevAvailable({ ...config, ENVIRONMENT: "test", SEEV_WEBHOOK_SECRET: undefined }, true)).toBe(true);
    expect(seevAvailable({ ...config, ENVIRONMENT: "test", SEEV_WEBHOOK_SECRET: undefined, SEEV_ENVIRONMENT: "production" }, false)).toBe(false);
    runtime.SEEV_ENABLED = "false";
    expect((await initialize(request())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a server-side checkout in pesewas and replays it without another order", async () => {
    const req = request();
    const first = await initialize(req.clone() as Request);
    const result = await first.json() as { reference: string; authorizationUrl: string };
    const replay = await initialize(req.clone() as Request);
    expect(await replay.json()).toEqual(result);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(createBody.amount).toBeGreaterThanOrEqual(20000);
    expect(createBody.channels).toEqual(["mobile_money"]);
    expect(createBody.recipient.name).toBe("Seev Buyer");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("idempotency-key")).toBe(createBody.meta.orderId);
    expect(await order(result.reference)).toMatchObject({ payment_provider: "seevplus", provider_reference: providerReference, paystack_reference: null, status: "payment_pending" });
    expect(await ticketCount(result.reference)).toBe(0);
    expect(await env.DB.prepare("SELECT request_json FROM seev_checkout_sessions WHERE order_id = ?").bind(createBody.meta.orderId).first()).toMatchObject({ request_json: null });
  });

  it("blocks switching to Paystack while a Seev payment remains pending", async () => {
    await checkout();
    const calls = fetchMock.mock.calls.length;
    const response = await initialize(request({ paymentProvider: "paystack" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("still pending") });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("rejects provider redirects without following them or issuing tickets", async () => {
    const result = await checkout();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.com/payment" } }));
    await expect(verifySeevPayment(env.DB, result.reference, runtime)).rejects.toThrow();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.redirect).toBe("manual");
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it("returns the recovered checkout to its owner when cron recovered initiation first", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Response lost"));
    const response = await initialize(request());
    const data = await response.json() as { reference: string; nextUrl: string };
    await createSeevCheckout(env.DB, data.reference, runtime);
    verifyOverrides = { status: "pending" };
    const callback = new URL(data.nextUrl, origin);
    const resumed = await claimTickets(new Request(`${origin}/api/customer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ reference: data.reference, claim: callback.searchParams.get("claim"), resumeCheckout: true }) }));
    expect(resumed.status).toBe(202);
    expect(await resumed.json()).toMatchObject({ authorizationUrl: `https://pay.seevplus.com/${providerReference}` });
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it("rejects card, unknown provider and missing name before charging", async () => {
    for (const body of [{ paymentMethod: "card" }, { paymentProvider: "other" }, { fullName: " " }]) expect((await initialize(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ amount: 1 }, { currency: "USD" }, { env: "production" }, { checkout_url: "https://pay.seevplus.com.evil.example/PAY-test" }])("holds an unsafe initiation response for review: %j", async (override) => {
    createOverrides = override;
    const response = await initialize(request());
    expect(response.status).toBe(202);
    const result = await response.json() as { reference: string };
    expect(await order(result.reference)).toMatchObject({ status: "payment_pending", provider_reference: null });
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it("recovers a lost initiation response using exactly the same body and key", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Response lost"));
    const req = request();
    const response = await initialize(req.clone() as Request);
    expect(response.status).toBe(202);
    const data = await response.json() as { reference: string };
    const firstInit = fetchMock.mock.calls[0][1];
    const recovered = await recoverSeevPayment(runtime, data.reference, origin);
    expect(recovered.result).toBe("checkout");
    const secondInit = fetchMock.mock.calls[1][1];
    expect(secondInit.body).toBe(firstInit.body);
    expect(secondInit.headers).toEqual(firstInit.headers);
    expect(await order(data.reference)).toMatchObject({ provider_reference: providerReference });
    expect((await initialize(req.clone() as Request)).status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([{ amount: 1 }, { final_amount: 1 }, { currency: "USD" }, { reference: "PAY-another-order" }, { env: "production" }])("rejects mismatched verified details: %j", async (override) => {
    const data = await checkout();
    verifyOverrides = override;
    await expect(verifySeevPayment(env.DB, data.reference, runtime)).rejects.toThrow("did not match");
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it.each(["pending", "failed", "cancelled"])("never issues tickets for %s", async (status) => {
    const data = await checkout();
    verifyOverrides = { status };
    expect((await verifySeevPayment(env.DB, data.reference, runtime)).result).toBe("pending");
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it("issues once under simultaneous verification and keeps Paystack fields untouched", async () => {
    const data = await checkout();
    const results = await Promise.all([verifySeevPayment(env.DB, data.reference, runtime), verifySeevPayment(env.DB, data.reference, runtime)]);
    expect(results.every((result) => result.result === "paid")).toBe(true);
    expect(await ticketCount(data.reference)).toBe(2);
    expect(await order(data.reference)).toMatchObject({ status: "paid", paystack_reference: null, provider_reference: providerReference });
  });

  it("prevents cross-provider fulfilment and refunds", async () => {
    const data = await checkout();
    expect((await fulfillVerifiedPayment(env.DB, { id: 1, reference: data.reference, status: "success", amount: createBody.amount, currency: "GHS", paidAt: null, channel: null, gatewayResponse: null })).result).toBe("mismatch");
    await verifySeevPayment(env.DB, data.reference, runtime);
    const calls = fetchMock.mock.calls.length;
    await expect(initiatePaystackRefund(env.DB, { orderId: createBody.meta.orderId, actor: "test", reason: "Test refund requested", secret: "test" })).rejects.toThrow("SeevPlus refunds require finance review");
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("does not revive a refunded order on a success replay", async () => {
    const data = await checkout();
    await verifySeevPayment(env.DB, data.reference, runtime);
    await env.DB.prepare("UPDATE orders SET status = 'refunded' WHERE reference = ?").bind(data.reference).run();
    await env.DB.prepare("UPDATE tickets SET status = 'refunded' WHERE order_id = ?").bind(createBody.meta.orderId).run();
    expect((await verifySeevPayment(env.DB, data.reference, runtime)).result).toBe("not_fulfilled");
    expect(await order(data.reference)).toMatchObject({ status: "refunded" });
  });

  it("recovers missed webhooks in the scheduled job with checkouts disabled", async () => {
    const data = await checkout();
    runtime.SEEV_ENABLED = "false";
    // Other scenarios intentionally leave unpaid fixtures. Keep this scheduler
    // test's queue scoped to the payment whose provider response is mocked.
    await env.DB.prepare("UPDATE seev_checkout_sessions SET lease_until = ? WHERE order_id <> ?").bind(new Date(Date.now() + 600000).toISOString(), createBody.meta.orderId).run();
    const result = await recoverSeevPayments(runtime, origin);
    expect(result.failed).toBe(0);
    expect(await ticketCount(data.reference)).toBe(2);
    expect(await order(data.reference)).toMatchObject({ status: "paid" });
  });

  it("does not create a new checkout after an unknown attempt expires", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Lost"));
    const response = await initialize(request());
    const data = await response.json() as { reference: string };
    await env.DB.prepare("UPDATE orders SET reservation_expires_at = '2020-01-01' WHERE reference = ?").bind(data.reference).run();
    await expect(createSeevCheckout(env.DB, data.reference, runtime)).rejects.toThrow("status review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a late successful payment for refund when its admissions are gone", async () => {
    const data = await checkout();
    await env.DB.prepare("UPDATE orders SET reservation_expires_at = '2020-01-01' WHERE reference = ?").bind(data.reference).run();
    await env.DB.prepare("UPDATE inventory_reservations SET expires_at = '2020-01-01' WHERE order_id = ?").bind(createBody.meta.orderId).run();
    await expireReservations(env.DB);
    await env.DB.prepare("UPDATE event_ticket_tiers SET capacity_admissions = 0 WHERE id = ?").bind(slug).run();
    expect((await verifySeevPayment(env.DB, data.reference, runtime)).result).toBe("requires_refund");
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it("unlocks the attendee session only with both payment and the original claim", async () => {
    const data = await checkout();
    const callback = new URL(createBody.redirect_url);
    const response = await claimTickets(new Request(`${origin}/api/customer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ reference: data.reference, claim: callback.searchParams.get("claim") }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ signedIn: true, eventSlug: slug });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await ticketCount(data.reference)).toBe(2);
  });

  it("excludes Seev orders from Paystack recovery and financial settlement runs", async () => {
    const data = await checkout();
    await env.DB.prepare("UPDATE orders SET status = 'expired' WHERE reference = ?").bind(data.reference).run();
    expect(await recoverAbandonedPayments(runtime, origin)).toEqual({ recovered: 0, fulfilled: 0 });
    await verifySeevPayment(env.DB, data.reference, runtime);
    const result = await runDailyReconciliation(env.DB, { secret: "test", periodStart: new Date(Date.now() - 3600000).toISOString(), periodEnd: new Date(Date.now() + 3600000).toISOString(), actor: "test" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_settlements WHERE run_id = ? AND event_slug = ?").bind(result.runId, slug).first()).toMatchObject({ count: 0 });
  });
});

describe("Seev USDC checkout", () => {
  beforeEach(async () => {
    runtime.SEEV_CRYPTO_ENABLED = "true";
    runtime.SEEV_ENVIRONMENT = "production";
    createOverrides = { env: "production" };
    verifyOverrides = { env: "production" };
    await env.DB.prepare("UPDATE curated_event_records SET is_test_event = 0 WHERE slug = ?").bind(slug).run();
  });

  async function cryptoCheckout() {
    const response = await initialize(request({ paymentMethod: "crypto" }));
    expect(response.status).toBe(200);
    return await response.json() as { reference: string; authorizationUrl: string };
  }

  it("requires explicit activation, a live environment and both secrets", () => {
    expect(seevCryptoAvailable(runtime, false)).toBe(true);
    expect(seevCryptoAvailable(runtime, true)).toBe(false);
    for (const override of [
      { SEEV_CRYPTO_ENABLED: undefined }, { SEEV_CRYPTO_ENABLED: "false" }, { SEEV_CRYPTO_ENABLED: "TRUE" },
      { SEEV_ENABLED: "false" }, { SEEV_ENVIRONMENT: "sandbox" },
      { SEEV_CHECKOUT_API_KEY: "" }, { SEEV_WEBHOOK_SECRET: "" },
    ]) expect(seevCryptoAvailable({ ...runtime, ...override }, false)).toBe(false);
  });

  it.each(["disabled", "sandbox", "test event", "missing key", "missing webhook"])("rejects crypto before creating an order when %s", async (condition) => {
    if (condition === "disabled") runtime.SEEV_CRYPTO_ENABLED = "false";
    if (condition === "sandbox") runtime.SEEV_ENVIRONMENT = "sandbox";
    if (condition === "test event") await env.DB.prepare("UPDATE curated_event_records SET is_test_event = 1 WHERE slug = ?").bind(slug).run();
    if (condition === "missing key") runtime.SEEV_CHECKOUT_API_KEY = "";
    if (condition === "missing webhook") runtime.SEEV_WEBHOOK_SECRET = "";
    expect((await initialize(request({ paymentMethod: "crypto" }))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug = ?").bind(slug).first()).toMatchObject({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE event_slug = ?").bind(slug).first()).toMatchObject({ count: 0 });
  });

  it("sends only crypto, preserves the GHS total and stored method, and replays once", async () => {
    const req = request({ paymentMethod: "crypto" });
    const response = await initialize(req.clone() as Request);
    expect(response.status).toBe(200);
    const result = await response.json() as { reference: string };
    expect(await (await initialize(req.clone() as Request)).json()).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createBody).toMatchObject({ channels: ["crypto"], currency: "GHS", amount: expect.any(Number) });
    expect(Number.isSafeInteger(createBody.amount)).toBe(true);
    expect(createBody.subaccount).toBeUndefined();
    expect(createBody.network).toBeUndefined();
    expect(await env.DB.prepare("SELECT payment_channel, currency, total_amount_minor FROM orders WHERE reference = ?").bind(result.reference).first()).toMatchObject({ payment_channel: "crypto", currency: "GHS", total_amount_minor: createBody.amount });
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it("rejects crypto via Paystack and a method change on an existing idempotency key", async () => {
    expect((await initialize(request({ paymentMethod: "crypto", paymentProvider: "paystack" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const key = crypto.randomUUID();
    expect((await initialize(request({ paymentMethod: "crypto" }, key))).status).toBe(200);
    expect((await initialize(request({ paymentMethod: "mobile_money" }, key))).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["crypto", "mobile_money"])("blocks switching away from pending or expired %s", async (firstMethod) => {
    const response = await initialize(request({ paymentMethod: firstMethod }));
    expect(response.status).toBe(200);
    const result = await response.json() as { reference: string };
    const otherMethod = firstMethod === "crypto" ? "mobile_money" : "crypto";
    for (const status of ["payment_pending", "expired"]) {
      await env.DB.prepare("UPDATE orders SET status = ? WHERE reference = ?").bind(status, result.reference).run();
      expect((await initialize(request({ paymentMethod: otherMethod }))).status).toBe(409);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reserves only one payment when Seev methods race", async () => {
    const responses = await Promise.all([initialize(request({ paymentMethod: "crypto" })), initialize(request({ paymentMethod: "mobile_money" }))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug = ?").bind(slug).first()).toMatchObject({ count: 1 });
  });

  it.each([{ amount: 1 }, { currency: "USDC" }, { env: "sandbox" }])("does not bind mismatched crypto initiation: %j", async override => {
    createOverrides = { ...createOverrides, ...override };
    const response = await initialize(request({ paymentMethod: "crypto" }));
    expect(response.status).toBe(202);
    const result = await response.json() as { reference: string };
    expect(await order(result.reference)).toMatchObject({ status: "payment_pending", provider_reference: null });
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it.each([{ amount: 1 }, { final_amount: 1 }, { final_amount: undefined }, { currency: "USDC" }, { reference: "PAY-other" }, { env: "sandbox" }])("rejects mismatched crypto verification: %j", async override => {
    const result = await cryptoCheckout();
    verifyOverrides = { ...verifyOverrides, ...override };
    await expect(verifySeevPayment(env.DB, result.reference, runtime)).rejects.toThrow("did not match");
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it.each(["pending", "failed", "cancelled", "unknown"])("never issues crypto tickets for %s", async status => {
    const result = await cryptoCheckout();
    verifyOverrides = { ...verifyOverrides, status };
    expect((await verifySeevPayment(env.DB, result.reference, runtime)).result).toBe("pending");
    expect(await ticketCount(result.reference)).toBe(0);
  });

  it("recovers the exact crypto request after disablement and rejects a split before sending", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Response lost"));
    const response = await initialize(request({ paymentMethod: "crypto" }));
    expect(response.status).toBe(202);
    const result = await response.json() as { reference: string };
    const firstRequest = fetchMock.mock.calls[0][1];
    runtime.SEEV_CRYPTO_ENABLED = "false";
    const original = JSON.parse(String(firstRequest.body));
    await env.DB.prepare("UPDATE seev_checkout_sessions SET request_json = ? WHERE order_id = ?").bind(JSON.stringify({ ...original, subaccount: "SUB_test" }), original.meta.orderId).run();
    await expect(createSeevCheckout(env.DB, result.reference, runtime)).rejects.toThrow("configuration needs review");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await env.DB.prepare("UPDATE seev_checkout_sessions SET request_json = ? WHERE order_id = ?").bind(String(firstRequest.body), original.meta.orderId).run();
    await createSeevCheckout(env.DB, result.reference, runtime);
    expect(fetchMock.mock.calls[1][1].body).toBe(firstRequest.body);
    expect(fetchMock.mock.calls[1][1].headers).toEqual(firstRequest.headers);
  });

  it("fulfills existing crypto once through a signed notification after both flags are off", async () => {
    const result = await cryptoCheckout();
    runtime.SEEV_CRYPTO_ENABLED = "false";
    runtime.SEEV_ENABLED = "false";
    expect((await webhook(await signedWebhook({ env: "production", data: { transaction: { reference: providerReference, env: "production", amount: 1, currency: "USDC", status: "completed" } } }))).status).toBe(200);
    // Webhook settlement fields never substitute for the verified GHS order.
    expect((await verifySeevPayment(env.DB, result.reference, runtime)).result).toBe("paid");
    expect(await ticketCount(result.reference)).toBe(2);
    expect(await env.DB.prepare("SELECT payment_channel, paystack_reference FROM orders WHERE reference = ?").bind(result.reference).first()).toMatchObject({ payment_channel: "crypto", paystack_reference: null });
  });
});

describe("Seev signed notifications", () => {
  it("verifies signed events server-side and ignores repeated delivery IDs", async () => {
    const data = await checkout();
    expect((await webhook(await signedWebhook({ id: "first" }))).status).toBe(200);
    expect((await webhook(await signedWebhook({ id: "manual-retry-new-id" }))).status).toBe(200);
    expect(await ticketCount(data.reference)).toBe(2);
    expect(await order(data.reference)).toMatchObject({ status: "paid" });
  });

  it("rejects forged, expired and wrong-environment notifications", async () => {
    const data = await checkout();
    const forged = await signedWebhook();
    forged.headers.set("x-seev-signature", "v1=" + "0".repeat(64));
    expect((await webhook(forged)).status).toBe(401);
    expect((await webhook(await signedWebhook({}, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await webhook(await signedWebhook({ env: "production" }))).status).toBe(400);
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it("ignores a signed success when the verification API still reports pending", async () => {
    const data = await checkout();
    verifyOverrides = { status: "pending" };
    expect((await webhook(await signedWebhook())).status).toBe(200);
    expect(await ticketCount(data.reference)).toBe(0);
  });

  it("uses current verification rather than an out-of-order failure notification", async () => {
    const data = await checkout();
    expect((await webhook(await signedWebhook({ event: "payment.failed" }))).status).toBe(200);
    expect(await order(data.reference)).toMatchObject({ status: "paid" });
    expect(await ticketCount(data.reference)).toBe(2);
  });

  it("accepts only the exact Seev hosted checkout origin", () => {
    expect(validSeevCheckoutUrl("https://pay.seevplus.com/PAY-123")).toBe(true);
    for (const url of ["http://pay.seevplus.com/PAY-123", "https://pay.seevplus.com.evil.example/PAY-123", "https://user@pay.seevplus.com/PAY-123", "javascript:alert(1)", "https://pay.seevplus.com/"]) expect(validSeevCheckoutUrl(url)).toBe(false);
  });
});

async function waitlistOffer() {
  const {hashToken}=await import('../lib/attendee-auth');
  const id=crypto.randomUUID(),token=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO event_waitlist_entries(id,event_slug,ticket_tier_id,normalized_email,status,offer_token_hash,offered_at,offer_expires_at,created_at,updated_at)
    VALUES(?,?,?,'seev@example.com','offered',?,?,?,?,?)`)
    .bind(id,slug,slug,await hashToken(token),now,new Date(Date.now()+600000).toISOString(),now,now).run();
  return {id,token};
}

it('claims a waitlist offer once across concurrent checkout attempts', async () => {
  const offer=await waitlistOffer();
  const outcomes=await Promise.all([initialize(request({offer:offer.token})),initialize(request({offer:offer.token}))]);
  expect(outcomes.filter(response=>response.status===200)).toHaveLength(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE waitlist_entry_id=?').bind(offer.id).first()).toEqual({n:1});
  expect(await env.DB.prepare('SELECT status FROM event_waitlist_entries WHERE id=?').bind(offer.id).first()).toEqual({status:'claimed'});
  expect(fetchMock.mock.calls.filter(([url])=>String(url)===api)).toHaveLength(1);
});

it.each(['cancelled','postponed'])('never lets an existing waitlist offer bypass a %s event', async (state) => {
  const offer=await waitlistOffer();
  await env.DB.prepare('UPDATE curated_event_records SET event_state=? WHERE slug=?').bind(state,slug).run();
  const response=await initialize(request({offer:offer.token}));
  expect(response.ok).toBe(false);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE waitlist_entry_id=?').bind(offer.id).first()).toEqual({n:0});
  expect(fetchMock).not.toHaveBeenCalled();
});
