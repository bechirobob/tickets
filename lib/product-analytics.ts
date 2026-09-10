import { productMetrics, type ProductMetric } from "./product-metrics";
export { productMetrics, type ProductMetric } from "./product-metrics";

export function isProductMetric(value: unknown): value is ProductMetric {
  return typeof value === "string" && (productMetrics as readonly string[]).includes(value);
}

export function validAnalyticsSlug(value: unknown) {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/u.test(value) ? value : "";
}

export async function recordProductMetric(db: D1Database, metric: ProductMetric, eventSlug = "", occurredAt = new Date()) {
  const day = occurredAt.toISOString().slice(0, 10);
  const now = occurredAt.toISOString();
  await db.prepare(`
    INSERT INTO product_metrics_daily (day, event_slug, metric, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(day, event_slug, metric) DO UPDATE SET
      count = count + 1,
      updated_at = excluded.updated_at
  `).bind(day, validAnalyticsSlug(eventSlug), metric, now).run();
}
