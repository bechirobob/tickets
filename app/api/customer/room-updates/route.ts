import { readRoomUpdateSummaries } from "../../../../lib/room-updates";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const rooms = await readRoomUpdateSummaries(env.DB, request.headers.get("cookie"));
  return Response.json({ rooms, unread: rooms.reduce((total, room) => total + room.unread, 0) },
    { headers: { "cache-control": "no-store, private", vary: "Cookie" } });
}
