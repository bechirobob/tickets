import { publicPageCacheKey, publicCacheResponse } from "./public-page-cache";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleRoomSocket } from "./room-socket";
import { requestNonce, contentSecurityPolicy, securityResponse } from "./security-response";
import { recordSecurityEvent, requestMetadata } from "../lib/admin-session";
import { processQueue, runScheduledOperations } from "./background";
export { TheRoom } from "./the-room";

const edgeCache = (caches as CacheStorage & { readonly default: Cache }).default;

function supportedImageFormat(format: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" {
  if (format === "image/jpeg" || format === "image/png" || format === "image/gif" || format === "image/avif") return format;
  return "image/webp";
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nonce = requestNonce();
    try {
      const cacheKey = publicPageCacheKey(request, url, env.CF_VERSION_METADATA?.id ?? env.RELEASE_SHA);
      if (cacheKey) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) return securityResponse(publicCacheResponse(cached, "HIT"));
      }
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
        const headers = new Headers(request.headers);
        headers.set("content-security-policy", contentSecurityPolicy(nonce));
        response = await handler.fetch(new Request(request, { headers }), env, ctx);
      }
      if (response.status === 101) return response;
      let secured = securityResponse(response, nonce, url.pathname);
      if (cacheKey && secured.status === 200 && secured.headers.get("content-type")?.includes("text/html")) {
        secured = publicCacheResponse(secured, "MISS");
        ctx.waitUntil(edgeCache.put(cacheKey, secured.clone()));
      }
      return secured;
    } catch (error) {
      const metadata = requestMetadata(request);
      const detail = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: "request failed", requestId: metadata.requestId, method: request.method, path: url.pathname, error: detail }));
      ctx.waitUntil(recordSecurityEvent(env.DB, { kind: "runtime_error", subject: metadata.ip, path: url.pathname, requestId: metadata.requestId, detail }));
      return securityResponse(Response.json({ error: "The service could not complete this request." }, { status: 500 }));
    }
  },
  queue: processQueue,
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledOperations(controller, env));
  },
};

export default worker satisfies ExportedHandler<Cloudflare.Env, { deliveryId: string }>;
