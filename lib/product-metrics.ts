export const productMetrics = [
  "event_view",
  "checkout_view",
  "checkout_started",
  "payment_attempted",
  "payment_confirmed",
  "payment_failed",
  "recovery_requested",
  "share_started",
  "pwa_prompt_shown",
  "pwa_install_accepted",
  "pwa_ios_guide_opened",
  "pwa_installed",
] as const;

export type ProductMetric = typeof productMetrics[number];
