/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { readAttendeeRoomAccess } from "../lib/attendee-auth";
import { resolveRoomPolicy } from "../lib/room-policy";
import { expireReservations, runDailyReconciliation } from "../lib/payment-operations";
import { refreshExpiredPreviewEvents } from "../lib/preview-events";
import { recordSecurityEvent, requestMetadata } from "../lib/admin-session";
import { purgeExpiredFlashes } from "../lib/flashes";
export { TheRoom } from "./the-room";

function supportedImageFormat(format: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" {
  if (format === "image/jpeg" || format === "image/png" || format === "image/gif" || format === "image/avif") return format;
  return "image/webp";
}

async function handleRoomSocket(request: Request, env: Cloudflare.Env): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) return new Response("Forbidden", { status: 403 });
  const eventSlug = requestUrl.searchParams.get("event")?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return new Response("Invalid event", { status: 400 });

  const [access, policy] = await Promise.all([
    readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), eventSlug),
    resolveRoomPolicy(env.DB, eventSlug),
  ]);
  if (!access || !policy) return new Response("A valid paid ticket is required", { status: 401 });
  const blocked = await env.DB.prepare(`
    SELECT blocked_attendee_id AS attendeeId
    FROM room_blocks
    WHERE event_slug = ? AND blocker_attendee_id = ?
    LIMIT 200
  `).bind(eventSlug, access.attendeeId).all<{ attendeeId: string }>();

  const headers = new Headers(request.headers);
  headers.set("x-bct-room-authorized", "1");
  headers.set("x-bct-attendee-id", access.attendeeId);
  headers.set("x-bct-display-name", encodeURIComponent(access.displayName));
  headers.set("x-bct-blocked-attendees", blocked.results.map((item) => item.attendeeId).join(","));
  headers.set("x-bct-event-slug", policy.eventSlug);
  headers.set("x-bct-event-title", encodeURIComponent(policy.eventTitle));
  headers.set("x-bct-starts-at", policy.startsAt);
  headers.set("x-bct-ends-at", policy.endsAt);
  headers.set("x-bct-read-only-at", policy.readOnlyAt);
  headers.set("x-bct-read-only", policy.readOnly ? "1" : "0");
  return env.THE_ROOM.getByName(eventSlug).fetch(new Request(request, { headers }));
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      let response: Response;
      if (url.pathname === "/api/room/socket") {
        response = await handleRoomSocket(request, env);
      } else if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        response = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format: supportedImageFormat(format), quality });
            return result.response();
          },
        }, allowedWidths);
      } else {
        response = await handler.fetch(request, env, ctx);
      }
      return response.status === 101 ? response : securityResponse(response);
    } catch (error) {
      const metadata = requestMetadata(request);
      const detail = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: "request failed", requestId: metadata.requestId, method: request.method, path: url.pathname, error: detail }));
      ctx.waitUntil(recordSecurityEvent(env.DB, { kind: "runtime_error", subject: metadata.ip, path: url.pathname, requestId: metadata.requestId, detail }));
      return securityResponse(Response.json({ error: "The service could not complete this request." }, { status: 500 }));
    }
  },
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledOperations(controller, env));
  },
};

function securityResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; font-src 'self' data:; connect-src 'self' wss: https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(self), display-capture=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.delete("X-Powered-By");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function recordSystemAlert(env: Cloudflare.Env, source: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ message: "scheduled operation failed", source, error: detail }));
  await env.DB.prepare(`INSERT INTO system_alerts (id, source, severity, message, detail, status, created_at) VALUES (?, ?, 'critical', ?, ?, 'open', ?)`)
    .bind(crypto.randomUUID(), source, `${source} failed`, detail.slice(0, 2000), new Date().toISOString()).run();
}

async function runScheduledOperations(controller: ScheduledController, env: Cloudflare.Env): Promise<void> {
  try {
    await purgeExpiredFlashes(env.DB, env.FLASHES_BUCKET);
  } catch (error) {
    await recordSystemAlert(env, "flash-expiry", error);
  }
  try {
    await expireReservations(env.DB);
  } catch (error) {
    await recordSystemAlert(env, "reservation-expiry", error);
  }
  if (controller.cron === "15 3 * * *") {
    try {
      await refreshExpiredPreviewEvents(env.DB);
    } catch (error) {
      await recordSystemAlert(env, "preview-event-rollover", error);
    }
  }
  if (controller.cron === "15 3 * * *" && env.PAYSTACK_SECRET_KEY) {
    try {
      const periodEnd = new Date();
      periodEnd.setUTCHours(0, 0, 0, 0);
      const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
      await runDailyReconciliation(env.DB, { secret: env.PAYSTACK_SECRET_KEY, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), actor: "system:daily-reconciliation" });
    } catch (error) {
      await recordSystemAlert(env, "daily-payment-reconciliation", error);
    }
  }
}

export default worker satisfies ExportedHandler<Cloudflare.Env>;
