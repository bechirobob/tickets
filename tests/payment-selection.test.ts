import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
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

  it("accepts tiers for newly published database events without a slug allowlist", async () => {
    const now = new Date().toISOString();
    const slug = "future-event-never-hard-coded";
    await env.DB.prepare(`
      INSERT INTO curated_event_records (
        id, submission_id, slug, title, venue, area, starts_at, ends_at,
        vibe, price_from_minor, image_url, curation_note, status,
        published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      "future-event-record",
      "future-event-submission",
      slug,
      "Future Event",
      "Future Venue",
      "Accra",
      "2027-01-15T21:00:00.000Z",
      "2027-01-16T03:00:00.000Z",
      "Late night",
      20_000,
      "https://example.com/future-event.jpg",
      "A future event created after this release must remain bookable.",
      "published",
      now,
      now,
      now,
    ).run();

    const response = await initializePayment(paymentRequest(slug, "vip"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Live Paystack credentials have not been connected yet." });
  });
});
