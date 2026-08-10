import type { CuratedEvent } from "../app/events";

const MAX_ADMISSIONS_PER_ORDER = 10;

export function resolveTicketSelection(
  event: CuratedEvent,
  ticketTierId: string | undefined,
  rawUnitQuantity: unknown,
) {
  const unitQuantity = Number(rawUnitQuantity);
  const tier = event.ticketTiers.find((candidate) => candidate.id === ticketTierId);

  if (
    !tier
    || tier.status !== "available"
    || !Number.isInteger(unitQuantity)
    || unitQuantity < 1
    || unitQuantity > tier.maxUnitsPerOrder
  ) return null;

  const ticketCount = unitQuantity * tier.admissionsPerUnit;
  if (ticketCount > MAX_ADMISSIONS_PER_ORDER) return null;

  return {
    tier,
    unitQuantity,
    ticketCount,
    faceAmountMinor: unitQuantity * tier.priceMinor,
  };
}
