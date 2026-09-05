import { describe, expect, it } from "vitest";
import { discoveryPrice, discoveryTotalMinor } from "../lib/event-pricing";
import { ticketSelectionEvent } from "./fixtures";

describe("fee-inclusive discovery prices", () => {
  it("shows the available tier rather than an unavailable lower headline price", () => {
    const event = { ...ticketSelectionEvent, ticketTiers: ticketSelectionEvent.ticketTiers.map((tier, index) => index === 0 ? { ...tier, status: "sold_out" as const } : tier) };
    expect(discoveryTotalMinor(event)).toBe(26875);
    expect(discoveryPrice(event)).toBe("268.75");
  });
  it("retains pesewas and rounds the fee once, as checkout does", () => {
    const event = { ...ticketSelectionEvent, bookingFeeBasisPoints: 825, ticketTiers: [{ ...ticketSelectionEvent.ticketTiers[0], priceMinor: 10001 }] };
    expect(discoveryTotalMinor(event)).toBe(10826);
    expect(discoveryPrice(event)).toBe("108.26");
  });
  it("honours a zero fee override", () => {
    expect(discoveryTotalMinor({ ...ticketSelectionEvent, bookingFeeBasisPoints: 0 })).toBe(12000);
  });
});
