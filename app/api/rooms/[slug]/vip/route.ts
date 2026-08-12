import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";

type VipSettings = {
  bottleServiceEnabled: number;
  bottleMenu: string | null;
  songSuggestionsEnabled: number;
  assistanceEnabled: number;
};

async function contextFor(request: Request, slug: string) {
  const { env } = await import("cloudflare:workers");
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  return { env, access };
}

async function settings(db: D1Database, slug: string): Promise<VipSettings> {
  return await db.prepare(`
    SELECT bottle_service_enabled AS bottleServiceEnabled, bottle_menu AS bottleMenu,
           song_suggestions_enabled AS songSuggestionsEnabled, assistance_enabled AS assistanceEnabled
    FROM event_vip_settings WHERE event_slug = ? LIMIT 1
  `).bind(slug).first<VipSettings>() ?? {
    bottleServiceEnabled: 0,
    bottleMenu: null,
    songSuggestionsEnabled: 0,
    assistanceEnabled: 0,
  };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { env, access } = await contextFor(request, slug);
  if (!access) return Response.json({ error: "A valid paid ticket is required." }, { status: 401 });
  if (access.roomBadge !== "VIP") return Response.json({ vip: false }, { headers: { "cache-control": "no-store" } });
  const [configuration, requests] = await Promise.all([
    settings(env.DB, slug),
    env.DB.prepare(`
      SELECT id, kind, detail, location, status, organizer_note AS organizerNote,
             created_at AS createdAt, updated_at AS updatedAt
      FROM vip_concierge_requests
      WHERE event_slug = ? AND attendee_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).bind(slug, access.attendeeId).all<Record<string, unknown>>(),
  ]);
  return Response.json({
    vip: true,
    settings: {
      bottleServiceEnabled: Boolean(configuration.bottleServiceEnabled),
      bottleMenu: configuration.bottleMenu,
      songSuggestionsEnabled: Boolean(configuration.songSuggestionsEnabled),
      assistanceEnabled: Boolean(configuration.assistanceEnabled),
    },
    requests: requests.results,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { env, access } = await contextFor(request, slug);
  if (!access || access.roomBadge !== "VIP") return Response.json({ error: "VIP ticket access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This concierge request was not accepted." }, { status: 403 });
  const body = await request.json() as { kind?: string; detail?: string; location?: string };
  const kind = String(body.kind ?? "");
  const configuration = await settings(env.DB, slug);
  const enabled = kind === "bottle_service" ? Boolean(configuration.bottleServiceEnabled)
    : kind === "song_suggestion" ? Boolean(configuration.songSuggestionsEnabled)
      : kind === "assistance" ? Boolean(configuration.assistanceEnabled) : false;
  if (!enabled) return Response.json({ error: "The Host has not opened that VIP perk for this Night." }, { status: 409 });
  const detail = String(body.detail ?? "").trim();
  const location = String(body.location ?? "").trim();
  if (detail.length < 2 || detail.length > 500) return Response.json({ error: "Add a short, useful request." }, { status: 400 });
  if (kind === "bottle_service" && (location.length < 2 || location.length > 120)) return Response.json({ error: "Tell the Host where the service team can find you." }, { status: 400 });

  const now = new Date().toISOString();
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM vip_concierge_requests
    WHERE attendee_id = ? AND event_slug = ? AND created_at > ?
  `).bind(access.attendeeId, slug, new Date(Date.now() - 60 * 60 * 1000).toISOString()).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 6) return Response.json({ error: "Your concierge queue is full for now. Let the Host catch up." }, { status: 429 });
  if (kind === "song_suggestion") {
    const active = await env.DB.prepare(`
      SELECT 1 AS found FROM vip_concierge_requests
      WHERE attendee_id = ? AND event_slug = ? AND kind = 'song_suggestion'
        AND status IN ('requested', 'considering') LIMIT 1
    `).bind(access.attendeeId, slug).first();
    if (active) return Response.json({ error: "You already have a song in the Host queue." }, { status: 409 });
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO vip_concierge_requests
      (id, event_slug, attendee_id, ticket_id, kind, detail, location, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
  `).bind(id, slug, access.attendeeId, access.ticketId, kind, detail, location || null, now, now).run();
  return Response.json({ requested: true, id, status: "requested" }, { status: 201 });
}
