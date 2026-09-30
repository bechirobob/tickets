// The retired checkout demo never represented a database event. Keep its
// identity permanently reserved so stale clients cannot initialize payments.
export const RETIRED_CHECKOUT_EVENT_SLUG = "checkout-preview-only";

export function isRetiredCheckoutEvent(slug: string | undefined): boolean {
  return slug?.trim().toLowerCase() === RETIRED_CHECKOUT_EVENT_SLUG;
}
