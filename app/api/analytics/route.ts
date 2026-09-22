import { hashToken, mutationHasValidOrigin, requestMetadata } from "../../../lib/admin-session";
import { isProductMetric, recordProductMetric, validAnalyticsSlug } from "../../../lib/product-analytics";
import { enforceRateLimit } from "../../../lib/security-controls";

const clientMetrics = new Set([
  "event_view",
  "rsvp_view",
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
  // Release checks identify themselves; their visits must never become guest analytics.
  if (request.headers.get('x-becore-analytics') === 'exclude' || /HeadlessChrome|Playwright|bot|crawler|spider/iu.test(request.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });
  const { env } = await import("cloudflare:workers");
  const body = await request.json().catch(() => null) as { metric?: unknown; eventSlug?: unknown } | null;
  if (!isProductMetric(body?.metric) || !clientMetrics.has(body.metric)) return new Response(null, { status: 204 });
  const metadata = requestMetadata(request);
  const allowed = await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `analytics:${await hashToken(metadata.ip || "anonymous")}`);
  if (!allowed) return new Response(null, { status: 204 });
  const slug = validAnalyticsSlug(body.eventSlug);
  if (["event_view", "rsvp_view", "checkout_view", "checkout_started", "share_started"].includes(body.metric)) {
    if (!slug || !await env.DB.prepare("SELECT 1 FROM curated_event_records WHERE slug=? AND status='published' AND removed_at IS NULL").bind(slug).first()) return new Response(null, { status: 204 });
  }
  await recordProductMetric(env.DB, body.metric, slug);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
