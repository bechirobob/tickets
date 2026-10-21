import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";
import { resolveRoomPolicy } from "../../../../../lib/room-policy";
import { captureRoomUpdateSnapshot } from "../../../../../lib/room-updates";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { env } = await import("cloudflare:workers");
  const [access, policy] = await Promise.all([
    readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug),
    resolveRoomPolicy(env.DB, slug),
  ]);
  if (!access || !policy) {
    return Response.json(
      { allowed: false, error: "A valid paid ticket is required to enter this Room." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const updateSnapshot = await captureRoomUpdateSnapshot(env.DB, request.headers.get("cookie"), slug, access.attendeeId);
  return Response.json(
    { allowed: true, attendee: { id: access.attendeeId, displayName: access.displayName, roomBadge: access.roomBadge }, room: policy, updateSnapshot },
    { headers: { "cache-control": "no-store" } },
  );
}
