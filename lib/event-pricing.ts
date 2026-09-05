import type { CuratedEvent } from "../app/events";

/** Advertise the face value of an available ticket/package. Fees belong to checkout. */
export function discoveryFaceMinor(event: CuratedEvent): number {
  const available = event.ticketTiers.filter((tier) => tier.status === "available");
  return available.length ? Math.min(...available.map((tier) => tier.priceMinor)) : event.priceFromMinor;
}

export function discoveryPrice(event: CuratedEvent): string {
  return new Intl.NumberFormat("en-GH", { maximumFractionDigits: 2 }).format(discoveryFaceMinor(event) / 100);
}
