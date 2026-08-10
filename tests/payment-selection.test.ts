import { describe, expect, it } from "vitest";
import { POST as initializePayment } from "../app/api/payments/initialize/route";
import { curatedEvents } from "../app/events";

function paymentRequest(eventSlug: string, ticketTierId: string, quantity = 1) {
  return new Request("https://tickets.becoreops.com/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventSlug,
      ticketTierId,
      quantity,
      email: "buyer@example.com",
      phone: "233000000000",
      fullName: "Ticket Buyer",
      network: "mtn",
    }),
  });
}

function legacyGeneralAdmissionRequest(eventSlug: string) {
  return new Request("https://tickets.becoreops.com/api/payments/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventSlug,
      quantity: 1,
      email: "buyer@example.com",
      phone: "233000000000",
      fullName: "Ticket Buyer",
      network: "mtn",
    }),
  });
}

describe("payment ticket validation", () => {
  it("accepts every advertised event and tier before reaching payment configuration", async () => {
    for (const event of curatedEvents) {
      for (const tier of event.ticketTiers) {
        const response = await initializePayment(paymentRequest(event.slug, tier.id));
        expect(response.status, `${event.slug}/${tier.id}`).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: "Live Paystack credentials have not been connected yet." });
      }
    }
  });

  it("rejects unknown events and ticket tiers", async () => {
    const unknownEvent = await initializePayment(paymentRequest("not-a-real-event", "general"));
    expect(unknownEvent.status).toBe(400);

    const unknownTier = await initializePayment(paymentRequest(curatedEvents[0].slug, "backstage"));
    expect(unknownTier.status).toBe(400);
  });

  it("keeps already-open General Admission checkouts compatible during deployment", async () => {
    const response = await initializePayment(legacyGeneralAdmissionRequest(curatedEvents[1].slug));
    expect(response.status).toBe(503);
  });
});
