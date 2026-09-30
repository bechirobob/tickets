import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as preview } from "../app/api/payments/preview/route";
import { POST as initialize } from "../app/api/payments/initialize/route";
import { findCuratedEvent } from "../app/events";
import { CHECKOUT_PREVIEW_EVENT_SLUG, CHECKOUT_PREVIEW_EXPIRES_AT, CHECKOUT_PREVIEW_METHODS, CHECKOUT_PREVIEW_SOURCE_SLUG, checkoutPreviewEvent, checkoutPreviewIsOpen } from "../lib/checkout-preview";
import { publicPageCacheKey } from "../worker/public-page-cache";
import { securityResponse } from "../worker/security-response";

const origin = "https://tickets.becoreops.com";
const request = (body: unknown, path = "preview", requestOrigin = origin) => new Request(`${origin}/api/payments/${path}`, {
  method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T13:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); });

function prohibitSideEffects() {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Preview must not contact a provider"); });
  const prepare = vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("Preview must not access the database"); });
  const batch = vi.spyOn(env.DB, "batch").mockImplementation(() => { throw new Error("Preview must not write to the database"); });
  const exec = vi.spyOn(env.DB, "exec").mockImplementation(() => { throw new Error("Preview must not write to the database"); });
  return () => { for (const spy of [fetch, prepare, batch, exec]) expect(spy).not.toHaveBeenCalled(); };
}

describe("temporary no-charge checkout preview", () => {
  it("copies the real poster and schedule without changing the source or advertising its demo stock as real", async () => {
    const source = await findCuratedEvent(CHECKOUT_PREVIEW_SOURCE_SLUG);
    expect(source).not.toBeNull();
    const before = structuredClone(source!);
    const check = prohibitSideEffects();
    const copy = checkoutPreviewEvent(source!);
    expect(source).toEqual(before);
    expect(copy).toMatchObject({ slug: CHECKOUT_PREVIEW_EVENT_SLUG, title: before.title, image: before.image, registrationMode: before.registrationMode, startsAt: before.startsAt, scheduleStatus: before.scheduleStatus, priceFromMinor: 10000, bookingFeeBasisPoints: 0 });
    expect(copy.ticketTiers).toHaveLength(1);
    expect(copy.ticketTiers[0]).toMatchObject({ recordId: CHECKOUT_PREVIEW_EVENT_SLUG, name: "Demo ticket", priceMinor: 10000, status: "available" });
    expect(copy.ticketTiers).not.toBe(source!.ticketTiers);
    check();
  });

  it.each(CHECKOUT_PREVIEW_METHODS)("simulates %s without provider calls, database access, orders or payment URLs", async paymentMethod => {
    const check = prohibitSideEffects();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await preview(request({ paymentMethod }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await response.json()).toEqual({ simulated: true, message: expect.stringContaining("No booking or ticket was created.") });
    }
    check();
  });

  it.each([null, [], {}, { paymentMethod: "bank" }, { paymentMethod: "card", email: "guest@example.com" }, { paymentMethod: "crypto", eventSlug: CHECKOUT_PREVIEW_SOURCE_SLUG }, { paymentMethod: "x".repeat(200) }])("rejects invalid or personal data payloads: %j", async body => {
    const check = prohibitSideEffects();
    expect((await preview(request(body))).status).toBe(400);
    check();
  });

  it("rejects cross-origin and malformed requests without side effects", async () => {
    const check = prohibitSideEffects();
    expect((await preview(request({ paymentMethod: "card" }, "preview", "https://example.com"))).status).toBe(403);
    const malformed = new Request(`${origin}/api/payments/preview`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" });
    expect((await preview(malformed)).status).toBe(400);
    const wrongType = new Request(`${origin}/api/payments/preview`, { method: "POST", headers: { origin }, body: "card" });
    expect((await preview(wrongType)).status).toBe(400);
    check();
  });

  it("expires at the shared deadline and never opens a payment afterward", async () => {
    const check = prohibitSideEffects();
    const deadline = Date.parse(CHECKOUT_PREVIEW_EXPIRES_AT);
    expect(checkoutPreviewIsOpen(deadline - 1)).toBe(true);
    expect(checkoutPreviewIsOpen(deadline)).toBe(false);
    vi.mocked(Date.now).mockReturnValue(deadline);
    expect((await preview(request({ paymentMethod: "card" }))).status).toBe(410);
    expect((await initialize(request({ eventSlug: CHECKOUT_PREVIEW_EVENT_SLUG }, "initialize"))).status).toBe(400);
    check();
  });

  it.each([CHECKOUT_PREVIEW_EVENT_SLUG, ` ${CHECKOUT_PREVIEW_EVENT_SLUG.toUpperCase()} `])("permanently blocks the reserved event at the live boundary: %s", async eventSlug => {
    const check = prohibitSideEffects();
    const response = await initialize(request({ eventSlug, ticketTierId: CHECKOUT_PREVIEW_EVENT_SLUG, paymentMethod: "crypto", paymentProvider: "seevplus", quantity: 1, fullName: "Guest", email: "guest@example.com", phone: "0240000000", acceptedPolicies: true }, "initialize"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This is a no-charge preview. Live payment is not allowed." });
    check();
  });

  it("does not cache or index the page or endpoint on either runtime", () => {
    for (const path of ["/checkout-preview", "/checkout-preview/", "/api/payments/preview"]) {
      const response = securityResponse(new Response("preview"), "test-nonce", path);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const url = new URL(path, origin);
      expect(publicPageCacheKey(new Request(url, { headers: { accept: "text/html" } }), url, "release")).toBeNull();
    }
  });
});
