import { mutationHasValidOrigin } from "../../../../../../lib/admin-session";
import { limitRequestBody } from "../../../../../../lib/request-body";
import { readAttendeeRoomAccess } from "../../../../../../lib/attendee-auth";
import { acknowledgeRoomUpdateSnapshot } from "../../../../../../lib/room-updates";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const headers = { "cache-control": "no-store, private" };
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403, headers });
  const bounded = await limitRequestBody(request);
  if (bounded instanceof Response) return bounded;
  const { env } = await import("cloudflare:workers");
  const { slug } = await context.params;
  const cookie = request.headers.get("cookie");
  if (!await readAttendeeRoomAccess(env.DB, cookie, slug)) return Response.json({ error: "Room access is required." }, { status: 401, headers });
  const body = await bounded.json().catch(() => null) as { snapshot?: unknown } | null;
  if (typeof body?.snapshot !== 'string' || !await acknowledgeRoomUpdateSnapshot(env.DB, cookie, slug, body.snapshot)) {
    return Response.json({ error: "Refresh the Room to check these updates." }, { status: 400, headers });
  }
  return Response.json({ updated: true }, { headers });
}
