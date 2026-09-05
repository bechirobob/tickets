import type { CuratedEvent } from "../app/events";

/** Quote one currently available ticket/package, using checkout's minor-unit rounding. */
export function discoveryTotalMinor(event: CuratedEvent): number {
  const available = event.ticketTiers.filter((tier) => tier.status === "available");
  const face = available.length ? Math.min(...available.map((tier) => tier.priceMinor)) : event.priceFromMinor;
  return face + Math.round(face * event.bookingFeeBasisPoints / 10_000);
}

export function discoveryPrice(event: CuratedEvent): string {
  return new Intl.NumberFormat("en-GH", { maximumFractionDigits: 2 }).format(discoveryTotalMinor(event) / 100);
}
