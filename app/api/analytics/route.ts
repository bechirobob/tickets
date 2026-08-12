import { hashToken, mutationHasValidOrigin, requestMetadata } from "../../../lib/admin-session";
import { isProductMetric, recordProductMetric, validAnalyticsSlug } from "../../../lib/product-analytics";
import { enforceRateLimit } from "../../../lib/security-controls";

const clientMetrics = new Set([
  "event_view",
  "checkout_view",
  "checkout_started",
  "share_started",
  "pwa_prompt_shown",
  "pwa_install_accepted",
  "pwa_ios_guide_opened",
  "pwa_installed",
]);

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return new Response(null, { status: 204 });
  const { env } = await import("cloudflare:workers");
  const body = await request.json().catch(() => null) as { metric?: unknown; eventSlug?: unknown } | null;
  if (!isProductMetric(body?.metric) || !clientMetrics.has(body.metric)) return new Response(null, { status: 204 });
  const metadata = requestMetadata(request);
  const allowed = await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `analytics:${await hashToken(metadata.ip || "anonymous")}`);
  if (!allowed) return new Response(null, { status: 204 });
  await recordProductMetric(env.DB, body.metric, validAnalyticsSlug(body.eventSlug));
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
