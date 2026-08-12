import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";

async function gateAccess(request: Request, eventSlug: string) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "gate.scan")) return { env, session: null };
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return { env, session: null };
  return { env, session };
}

export async function GET(request: Request) {
  const eventSlug = new URL(request.url).searchParams.get("eventSlug")?.trim() ?? "";
  const { env, session } = await gateAccess(request, eventSlug);
  if (!session) return Response.json({ error: "This door list is not assigned to your account." }, { status: 403 });
  const [guests, tiers] = await Promise.all([
    env.DB.prepare("SELECT id, guest_name AS guestName, guest_email AS guestEmail, guest_phone AS guestPhone, admission_count AS admissionCount, kind, note, status, checked_in_at AS checkedInAt FROM guest_entries WHERE event_slug = ? AND status != 'cancelled' ORDER BY status, guest_name LIMIT 500").bind(eventSlug).all(),
    env.DB.prepare("SELECT id, code, name, price_minor AS priceMinor, admissions_per_unit AS admissionsPerUnit FROM event_ticket_tiers WHERE event_slug = ? AND status = 'available' ORDER BY sort_order, name").bind(eventSlug).all(),
  ]);
  return Response.json({ guests: guests.results, tiers: tiers.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This door action was not accepted." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const eventSlug = String(body.eventSlug ?? "");
  const { env, session } = await gateAccess(request, eventSlug);
  if (!session) return Response.json({ error: "This door list is not assigned to your account." }, { status: 403 });
  const action = String(body.action ?? "");
  const now = new Date().toISOString();
  if (action === "add") {
    const guestName = String(body.guestName ?? "").trim().slice(0, 120);
    const admissionCount = Math.max(1, Math.min(20, Math.floor(Number(body.admissionCount) || 1)));
    if (!guestName) return Response.json({ error: "Add the guest name." }, { status: 400 });
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO guest_entries (id, event_slug, guest_name, guest_email, guest_phone, admission_count, kind, note, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expected', ?, ?)")
      .bind(id, eventSlug, guestName, String(body.guestEmail ?? "").trim().slice(0, 200) || null, String(body.guestPhone ?? "").trim().slice(0, 50) || null, admissionCount, ["complimentary", "will_call"].includes(String(body.kind)) ? body.kind : "guest_list", String(body.note ?? "").trim().slice(0, 500) || null, session.email, now).run();
    await recordAudit(env.DB, { session, action: "door.guest_added", targetType: "guest_entry", targetId: id, outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "check_in") {
    const result = await env.DB.prepare("UPDATE guest_entries SET status = 'checked_in', checked_in_at = ?, checked_in_by = ? WHERE id = ? AND event_slug = ? AND status = 'expected'")
      .bind(now, session.email, String(body.id ?? ""), eventSlug).run();
    if (result.meta.changes !== 1) return Response.json({ error: "This guest is no longer waiting at the door." }, { status: 409 });
    await recordAudit(env.DB, { session, action: "door.guest_checked_in", targetType: "guest_entry", targetId: String(body.id ?? ""), outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ checkedIn: true });
  }
  return Response.json({ error: "Choose a valid door action." }, { status: 400 });
}
