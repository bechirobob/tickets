import { describe, expect, it } from "vitest";
import { curatedEvents } from "../app/events";
import { resolveTicketSelection } from "../lib/ticket-selection";

describe("ticket tier selection", () => {
  const event = curatedEvents[0];

  it("prices every advertised tier from the shared event catalogue", () => {
    expect(resolveTicketSelection(event, "general", 2)).toMatchObject({ unitQuantity: 2, ticketCount: 2, faceAmountMinor: 24_000 });
    expect(resolveTicketSelection(event, "vip", 2)).toMatchObject({ unitQuantity: 2, ticketCount: 2, faceAmountMinor: 50_000 });
    expect(resolveTicketSelection(event, "table-for-5", 1)).toMatchObject({ unitQuantity: 1, ticketCount: 5, faceAmountMinor: 180_000 });
  });

  it("rejects unknown, sold-out, fractional and excessive selections", () => {
    expect(resolveTicketSelection(event, "backstage", 1)).toBeNull();
    expect(resolveTicketSelection(event, "general", 1.5)).toBeNull();
    expect(resolveTicketSelection(event, "table-for-5", 3)).toBeNull();

    const soldOutEvent = {
      ...event,
      ticketTiers: event.ticketTiers.map((tier) => tier.id === "vip" ? { ...tier, status: "sold_out" as const } : tier),
    };
    expect(resolveTicketSelection(soldOutEvent, "vip", 1)).toBeNull();
  });
});
