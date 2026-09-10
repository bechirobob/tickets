import { describe, expect, it } from "vitest";
import { discoveryPrice, discoveryFaceMinor, discoveryOffer } from "../lib/event-pricing";
import { ticketSelectionEvent } from "./fixtures";

describe("face-value discovery prices", () => {
  it.each(['rsvp', 'interest'] as const)('routes %s events to registration even with paid tiers present', (registrationMode) => {
    const offer = discoveryOffer({ ...ticketSelectionEvent, registrationMode });
    expect(offer.href).toBe('/rsvp/test-event');
    expect(offer.label).not.toContain('GH₵');
    expect(offer.action).toBe(registrationMode === 'rsvp' ? 'RSVP' : 'Keep me posted');
  });
  it.each(['cancelled', 'postponed', 'sold_out'] as const)('does not offer checkout for a %s event with stale available tiers', (eventState) => {
    expect(discoveryOffer({ ...ticketSelectionEvent, eventState }).href).toBe('/event/test-event');
  });
  it("shows the available tier rather than an unavailable lower headline price", () => {
    const event = { ...ticketSelectionEvent, ticketTiers: ticketSelectionEvent.ticketTiers.map((tier, index) => index === 0 ? { ...tier, status: "sold_out" as const } : tier) };
    expect(discoveryFaceMinor(event)).toBe(25000);
    expect(discoveryPrice(event)).toBe("250");
  });
  it("retains pesewas without adding the checkout fee", () => {
    const event = { ...ticketSelectionEvent, bookingFeeBasisPoints: 825, ticketTiers: [{ ...ticketSelectionEvent.ticketTiers[0], priceMinor: 10001 }] };
    expect(discoveryFaceMinor(event)).toBe(10001);
    expect(discoveryPrice(event)).toBe("100.01");
  });
  it.each([0, 750, 1100])("keeps the advertised price when the fee is %i basis points", (bookingFeeBasisPoints) => {
    expect(discoveryFaceMinor({ ...ticketSelectionEvent, bookingFeeBasisPoints })).toBe(12000);
  });
});
