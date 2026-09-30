import type { CuratedEvent } from "./customer-screen";

// This identity is never a database event. Live payment initialization rejects it
// permanently, even after the temporary preview expires.
export const CHECKOUT_PREVIEW_EVENT_SLUG = "checkout-preview-only";
export const CHECKOUT_PREVIEW_SOURCE_SLUG = "sun-chasers-labadi";
export const CHECKOUT_PREVIEW_EXPIRES_AT = "2026-10-07T23:59:59Z";
export const CHECKOUT_PREVIEW_PRICE_MINOR = 10_000;
export const CHECKOUT_PREVIEW_METHODS = ["mobile_money", "card", "crypto"] as const;
export type CheckoutPreviewMethod = typeof CHECKOUT_PREVIEW_METHODS[number];

export function checkoutPreviewIsOpen(now = Date.now()): boolean {
  return now < Date.parse(CHECKOUT_PREVIEW_EXPIRES_AT);
}

export function isCheckoutPreviewEvent(slug: string | undefined): boolean {
  return slug?.trim().toLowerCase() === CHECKOUT_PREVIEW_EVENT_SLUG;
}

/** A read-only presentation copy. Never write demo pricing or stock to the event. */
export function checkoutPreviewEvent(source: CuratedEvent): CuratedEvent {
  return {
    ...source,
    slug: CHECKOUT_PREVIEW_EVENT_SLUG,
    price: CHECKOUT_PREVIEW_PRICE_MINOR / 100,
    priceFromMinor: CHECKOUT_PREVIEW_PRICE_MINOR,
    bookingFeeBasisPoints: 0,
    ticketTiers: [{
      id: CHECKOUT_PREVIEW_EVENT_SLUG,
      recordId: CHECKOUT_PREVIEW_EVENT_SLUG,
      name: "Demo ticket",
      description: "Example pricing only · no admission or reservation",
      priceMinor: CHECKOUT_PREVIEW_PRICE_MINOR,
      admissionsPerUnit: 1,
      maxUnitsPerOrder: 6,
      capacityAdmissions: 6,
      remainingAdmissions: 6,
      status: "available",
      roomBadge: null,
    }],
  };
}

export const checkoutPreviewMessages: Record<CheckoutPreviewMethod, string> = {
  mobile_money: "In a real checkout, your chosen provider would handle the Mobile Money approval. No phone prompt was sent and no money was charged. No booking or ticket was created.",
  card: "In a real checkout, Paystack would securely collect your Visa or Mastercard details. No card details were requested and no money was charged. No booking or ticket was created.",
  crypto: "In a real checkout, SeevPlus would show the USDC amount, asset and supported network. No wallet was connected and no transfer was requested. No booking or ticket was created.",
};
