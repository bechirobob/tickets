import { describe, expect, it } from "vitest";
import { discoveryPrice, discoveryFaceMinor } from "../lib/event-pricing";
import { ticketSelectionEvent } from "./fixtures";

describe("face-value discovery prices", () => {
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
