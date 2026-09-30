import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as initialize } from "../app/api/payments/initialize/route";
import { RETIRED_CHECKOUT_EVENT_SLUG, isRetiredCheckoutEvent } from "../lib/retired-checkout";

const runtimeAccess = vi.hoisted(() => vi.fn());
vi.mock("cloudflare:workers", () => ({
  get env() {
    runtimeAccess();
    throw new Error("Retired checkout must not access runtime bindings");
  },
}));

const origin = "https://tickets.becoreops.com";
const request = (eventSlug: string, paymentMethod = "crypto", paymentProvider = "seevplus") => new Request(`${origin}/api/payments/initialize`, {
  method: "POST",
  headers: { origin, "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111111" },
  body: JSON.stringify({
    eventSlug, ticketTierId: RETIRED_CHECKOUT_EVENT_SLUG, quantity: 1,
    paymentMethod, paymentProvider, network: "mtn",
    fullName: "Guest", email: "guest@example.com", phone: "0240000000", acceptedPolicies: true,
  }),
});

beforeEach(() => { runtimeAccess.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

function prohibitSideEffects() {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Retired checkout must not contact a provider"); });
  const prepare = vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("Retired checkout must not access the database"); });
  const batch = vi.spyOn(env.DB, "batch").mockImplementation(() => { throw new Error("Retired checkout must not write to the database"); });
  const exec = vi.spyOn(env.DB, "exec").mockImplementation(() => { throw new Error("Retired checkout must not write to the database"); });
  return () => { for (const spy of [runtimeAccess, fetch, prepare, batch, exec]) expect(spy).not.toHaveBeenCalled(); };
}

describe("retired checkout identity", () => {
  it("fails closed if the test reaches runtime bindings", async () => {
    const runtime = await import("cloudflare:workers");
    expect(() => runtime.env).toThrow("Retired checkout must not access runtime bindings");
    expect(runtimeAccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    [RETIRED_CHECKOUT_EVENT_SLUG, "crypto", "seevplus"],
    [` ${RETIRED_CHECKOUT_EVENT_SLUG.toUpperCase()} `, "crypto", "seevplus"],
    [RETIRED_CHECKOUT_EVENT_SLUG, "card", "paystack"],
    [RETIRED_CHECKOUT_EVENT_SLUG, "mobile_money", "paystack"],
    [RETIRED_CHECKOUT_EVENT_SLUG, "mobile_money", "seevplus"],
  ])("blocks %s through %s/%s before runtime, providers or database access", async (eventSlug, paymentMethod, paymentProvider) => {
    const check = prohibitSideEffects();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await initialize(request(eventSlug, paymentMethod, paymentProvider));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "This checkout preview has been retired. Live payment is not allowed." });
    }
    check();
  });

  it("keeps the retired identity reserved without reserving ordinary event slugs", () => {
    expect(isRetiredCheckoutEvent(RETIRED_CHECKOUT_EVENT_SLUG)).toBe(true);
    expect(isRetiredCheckoutEvent(` ${RETIRED_CHECKOUT_EVENT_SLUG.toUpperCase()} `)).toBe(true);
    for (const slug of [undefined, "", "sun-chasers-labadi", "paid-event", "checkout-preview-only-real"]) {
      expect(isRetiredCheckoutEvent(slug)).toBe(false);
    }
  });
});
