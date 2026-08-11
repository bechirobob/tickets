export type TicketTierStatus = "available" | "sold_out" | "hidden" | "upcoming" | "closed";

export type TicketTier = {
  id: string;
  recordId: string;
  name: string;
  description: string;
  priceMinor: number;
  admissionsPerUnit: number;
  maxUnitsPerOrder: number;
  capacityAdmissions: number;
  remainingAdmissions: number;
  status: TicketTierStatus;
};

export function formatGhanaCedis(amountMinor: number) {
  return `GH₵${(amountMinor / 100).toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
