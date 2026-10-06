import { mutationHasValidOrigin } from "../../../../lib/admin-session";
import { unsubscribePlatformAnnouncements } from "../../../../lib/platform-announcements";
import { limitRequestBody } from "../../../../lib/request-body";

export async function POST(request: Request) {
  const bounded = await limitRequestBody(request, 1024);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const form = await request.formData().catch(() => null), token = form?.get("token");
  if (typeof token === "string") {
    const { env } = await import("cloudflare:workers");
    await unsubscribePlatformAnnouncements(env.DB, token);
  }
  return new Response(null, { status: 303, headers: { location: "/platform-announcements/unsubscribe?done=1", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
