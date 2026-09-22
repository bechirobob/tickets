import { readAttendeeRoomSocketAccess } from "../lib/attendee-auth";

export async function authorizeRoomSocket(request: Request, env: Cloudflare.Env): Promise<Request | Response> {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) return new Response("Forbidden", { status: 403 });
  const eventSlug = requestUrl.searchParams.get("event")?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return new Response("Invalid event", { status: 400 });

  const authorization = await readAttendeeRoomSocketAccess(env.DB, request.headers.get("cookie"), eventSlug);
  if (!authorization?.policy) return new Response("A valid paid ticket is required", { status: 401 });
  // Authorization, event policy and this guest's blocks share one fresh D1
  // snapshot, avoiding a second queued read during simultaneous arrivals.
  const { access, blockedAttendeeIds, policy } = authorization;

  const headers = new Headers(request.headers);
  headers.set("x-bct-room-authorized", "1");
  headers.set("x-bct-attendee-id", access.attendeeId);
  headers.set("x-bct-session-id", access.sessionId ?? "");
  headers.set("x-bct-display-name", encodeURIComponent(access.displayName));
  headers.set("x-bct-room-badge", access.roomBadge ?? "");
  headers.set("x-bct-blocked-attendees", blockedAttendeeIds.join(","));
  headers.set("x-bct-event-slug", policy.eventSlug);
  headers.set("x-bct-event-title", encodeURIComponent(policy.eventTitle));
  headers.set("x-bct-starts-at", policy.startsAt);
  headers.set("x-bct-ends-at", policy.endsAt);
  headers.set("x-bct-read-only-at", policy.readOnlyAt);
  headers.set("x-bct-read-only", policy.readOnly ? "1" : "0");
  headers.set("x-bct-emergency-read-only", policy.emergencyReadOnly ? "1" : "0");
  headers.set("x-bct-slow-mode-seconds", String(policy.slowModeSeconds));
  headers.set("x-bct-archived", policy.archived ? "1" : "0");
  return new Request(request, { headers });
}

export async function handleRoomSocket(request: Request, env: Cloudflare.Env): Promise<Response> {
  const authorized = await authorizeRoomSocket(request, env);
  if (authorized instanceof Response) return authorized;
  return env.THE_ROOM.getByName(new URL(request.url).searchParams.get('event')!).fetch(authorized);
}
