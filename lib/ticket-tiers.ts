export type TicketTierStatus = "available" | "sold_out" | "hidden";

export type TicketTier = {
  id: "general" | "vip" | "table-for-5";
  name: string;
  description: string;
  priceMinor: number;
  admissionsPerUnit: number;
  maxUnitsPerOrder: number;
  status: TicketTierStatus;
};

export function createStandardTicketTiers(generalAdmissionPriceMinor: number): TicketTier[] {
  return [
    {
      id: "general",
      name: "General admission",
      description: "For people who can arrive before the plot thickens",
      priceMinor: generalAdmissionPriceMinor,
      admissionsPerUnit: 1,
      maxUnitsPerOrder: 10,
      status: "available",
    },
    {
      id: "vip",
      name: "VIP",
      description: "Priority entry + less queue, more composure",
      priceMinor: 25_000,
      admissionsPerUnit: 1,
      maxUnitsPerOrder: 10,
      status: "available",
    },
    {
      id: "table-for-5",
      name: "Table for 5",
      description: "Five VIP entries. Group-chat arithmetic solved.",
      priceMinor: 180_000,
      admissionsPerUnit: 5,
      maxUnitsPerOrder: 2,
      status: "available",
    },
  ];
}

export function formatGhanaCedis(amountMinor: number) {
  return `GH₵${(amountMinor / 100).toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
