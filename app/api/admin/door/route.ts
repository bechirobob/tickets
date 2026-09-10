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
  const params=new URL(request.url).searchParams,q=(params.get('q')??'').trim().slice(0,120),offset=Math.max(0,Math.min(50000,Math.floor(Number(params.get('offset')))||0));
  const base=`event_slug=? AND status<>'cancelled' AND (created_by<>'system:rsvp' OR EXISTS (SELECT 1 FROM event_registrations r WHERE 'rsvp:'||r.id=guest_entries.id AND r.status='confirmed' AND r.verified_at IS NULL))`;
  const search=`AND (?='' OR guest_name LIKE ? OR guest_email LIKE ? OR guest_phone LIKE ?)`;
  const terms=[q,`%${q}%`,`%${q}%`,`%${q}%`];
  const [guests,tiers,total,counts]=await Promise.all([
    env.DB.prepare(`SELECT id,guest_name AS guestName,admission_count AS admissionCount,kind,note,status,checked_in_at AS checkedInAt FROM guest_entries WHERE ${base} ${search} ORDER BY status DESC,guest_name,id LIMIT 10 OFFSET ?`).bind(eventSlug,...terms,offset).all(),
    env.DB.prepare("SELECT id,code,name,price_minor AS priceMinor,admissions_per_unit AS admissionsPerUnit FROM event_ticket_tiers WHERE event_slug=? AND status='available' ORDER BY sort_order,name").bind(eventSlug).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM guest_entries WHERE ${base} ${search}`).bind(eventSlug,...terms).first<{count:number}>(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status='expected' THEN admission_count ELSE 0 END),0) AS expected,COALESCE(SUM(CASE WHEN status='checked_in' THEN admission_count ELSE 0 END),0) AS admitted FROM guest_entries WHERE ${base}`).bind(eventSlug).first<{expected:number;admitted:number}>(),
  ]);
  return Response.json({guests:guests.results,tiers:tiers.results,total:total?.count??0,expected:counts?.expected??0,admitted:counts?.admitted??0},{headers:{'cache-control':'no-store'}});
}

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This door action was not accepted." }, { status: 403 });
  const body = await request.json().catch(()=>null) as Record<string, unknown> | null;
  if (!body || typeof body.eventSlug!=="string") return Response.json({error:"Choose an event."},{status:400});
  const eventSlug = String(body.eventSlug ?? "");
  const { env, session } = await gateAccess(request, eventSlug);
  if (!session) return Response.json({ error: "This door list is not assigned to your account." }, { status: 403 });
  if (!await env.DB.prepare("SELECT 1 FROM curated_event_records WHERE slug = ? AND removed_at IS NULL AND status='published' AND event_state NOT IN ('cancelled','postponed','past') AND schedule_status <> 'coming_soon'").bind(eventSlug).first()) return Response.json({ error: "Door entry is paused for this event." }, { status: 409 });
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
    const result = await env.DB.prepare("UPDATE guest_entries SET status = 'checked_in', checked_in_at = ?, checked_in_by = ? WHERE id = ? AND event_slug = ? AND status = 'expected' AND (created_by<>'system:rsvp' OR EXISTS (SELECT 1 FROM event_registrations r WHERE 'rsvp:'||r.id=guest_entries.id AND r.status='confirmed' AND r.verified_at IS NULL))")
      .bind(now, session.email, String(body.id ?? ""), eventSlug).run();
    if (result.meta.changes !== 1) return Response.json({ error: "This guest is no longer waiting at the door." }, { status: 409 });
    await recordAudit(env.DB, { session, action: "door.guest_checked_in", targetType: "guest_entry", targetId: String(body.id ?? ""), outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ checkedIn: true });
  }
  return Response.json({ error: "Choose a valid door action." }, { status: 400 });
}
