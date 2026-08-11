import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";
import { loadTicketedEventExperience } from "../../../../../lib/event-experience";

async function access(request: Request, slug: string) {
  const { env } = await import("cloudflare:workers");
  const attendee = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  return { env, attendee };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { env, attendee } = await access(request, slug);
  if (!attendee) return Response.json({ error: "A valid ticket for this night is required." }, { status: 401, headers: { "cache-control": "no-store" } });
  const experience = await loadTicketedEventExperience(env.DB, attendee.attendeeId, slug);
  return Response.json({ attendee: { displayName: attendee.displayName }, ...experience }, { headers: { "cache-control": "no-store, private" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const { slug } = await context.params;
  const { env, attendee } = await access(request, slug);
  if (!attendee) return Response.json({ error: "A valid ticket for this night is required." }, { status: 401 });
  const body = await request.json() as { attendeeVisible?: boolean; keepPosted?: boolean; answers?: Array<{ questionId?: string; answer?: string }> };
  if (body.attendeeVisible !== undefined && typeof body.attendeeVisible !== "boolean") return Response.json({ error: "The attendee visibility choice is invalid." }, { status: 400 });
  if (body.keepPosted !== undefined && typeof body.keepPosted !== "boolean") return Response.json({ error: "The update preference is invalid." }, { status: 400 });

  const current = await loadTicketedEventExperience(env.DB, attendee.attendeeId, slug);
  const visible = body.attendeeVisible ?? current.preference.attendeeVisible;
  const keepPosted = body.keepPosted ?? current.preference.keepPosted;
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(`
    INSERT INTO attendee_event_preferences (attendee_id, event_slug, attendee_visible, keep_posted, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(attendee_id, event_slug) DO UPDATE SET
      attendee_visible = excluded.attendee_visible,
      keep_posted = excluded.keep_posted,
      updated_at = excluded.updated_at
  `).bind(attendee.attendeeId, slug, visible, keepPosted, now)];

  const questionMap = new Map(current.questions.map((question) => [question.id, question]));
  for (const item of body.answers ?? []) {
    const questionId = item.questionId?.trim() ?? "";
    const answer = item.answer?.trim() ?? "";
    const question = questionMap.get(questionId);
    if (!question || answer.length > 500 || (question.required && !answer) || (question.kind === "choice" && answer && !question.options.includes(answer))) {
      return Response.json({ error: "One of the Before the Night answers is invalid." }, { status: 400 });
    }
    statements.push(env.DB.prepare(`
      INSERT INTO attendee_question_answers (question_id, attendee_id, answer, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(question_id, attendee_id) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at
    `).bind(questionId, attendee.attendeeId, answer, now));
  }
  await env.DB.batch(statements);
  return Response.json({ saved: true, preference: { attendeeVisible: visible, keepPosted } });
}
