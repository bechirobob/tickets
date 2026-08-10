/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { readAttendeeRoomAccess } from "../lib/attendee-auth";
import { resolveRoomPolicy } from "../lib/room-policy";
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

    if (url.pathname === "/api/room/socket") {
      return handleRoomSocket(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format: supportedImageFormat(format), quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker satisfies ExportedHandler<Cloudflare.Env>;
