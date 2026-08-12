import type { ProductMetric } from "./product-analytics";

export function trackProductMetric(metric: ProductMetric, eventSlug = "") {
  if (typeof window === "undefined") return;
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metric, eventSlug }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
