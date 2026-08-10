import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { curatedEventRecords, curationAuditEvents, partySubmissions } from "../../../../db/schema";
import { readAdminSession } from "../../../../lib/admin-auth";

export const dynamic = "force-dynamic";

type SubmissionStatus = "submitted" | "in_review" | "changes_requested" | "approved" | "rejected" | "scheduled" | "published" | "unpublished" | "archived";
type Action = "start_review" | "request_changes" | "approve" | "reject" | "schedule" | "publish" | "unpublish" | "archive";

const transitions: Record<Action, SubmissionStatus[]> = {
  start_review: ["submitted", "changes_requested"],
  request_changes: ["submitted", "in_review", "approved"],
  approve: ["in_review", "changes_requested"],
  reject: ["submitted", "in_review", "changes_requested"],
  schedule: ["approved", "unpublished", "scheduled"],
  publish: ["approved", "scheduled", "unpublished"],
  unpublish: ["published", "scheduled"],
  archive: ["rejected", "unpublished"],
};

const targetStatus: Record<Action, SubmissionStatus> = {
  start_review: "in_review",
  request_changes: "changes_requested",
  approve: "approved",
  reject: "rejected",
  schedule: "scheduled",
  publish: "published",
  unpublish: "unpublished",
  archive: "archived",
};

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}

async function actorOrUnauthorized(request: Request) {
  return readAdminSession(request.headers.get("cookie"));
}

export async function GET(request: Request) {
  const actor = await actorOrUnauthorized(request);
  if (!actor) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const db = await getDb();
  const submissions = await db.select().from(partySubmissions).orderBy(desc(partySubmissions.createdAt));
  return Response.json({ submissions });
}

export async function PATCH(request: Request) {
  const actor = await actorOrUnauthorized(request);
  if (!actor) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const body = await request.json() as { id?: string; action?: Action; note?: string; curationNote?: string; scheduledPublishAt?: string };
  if (!body.id || !body.action || !transitions[body.action]) return Response.json({ error: "Invalid review action." }, { status: 400 });

  const db = await getDb();
  const [current] = await db.select().from(partySubmissions).where(eq(partySubmissions.id, body.id)).limit(1);
  if (!current) return Response.json({ error: "Submission not found." }, { status: 404 });
  if (!transitions[body.action].includes(current.status as SubmissionStatus)) {
    return Response.json({ error: `Cannot ${body.action.replaceAll("_", " ")} a ${current.status.replaceAll("_", " ")} submission.` }, { status: 409 });
  }

  const next = targetStatus[body.action];
  const now = new Date().toISOString();
  const curationNote = String(body.curationNote ?? current.curationNote ?? "").trim();
  const reviewNote = String(body.note ?? "").trim() || current.reviewNote;
  if (["request_changes", "reject"].includes(body.action) && !String(body.note ?? "").trim()) {
    return Response.json({ error: "Add a clear note for the organiser." }, { status: 400 });
  }
  if (["approve", "schedule", "publish"].includes(body.action) && curationNote.length < 25) {
    return Response.json({ error: "Add a useful ‘why it made the list’ note first." }, { status: 400 });
  }

  let scheduledPublishAt: string | null = current.scheduledPublishAt;
  if (body.action === "schedule") {
    const timestamp = new Date(String(body.scheduledPublishAt ?? "")).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return Response.json({ error: "Choose a future publication time." }, { status: 400 });
    scheduledPublishAt = new Date(timestamp).toISOString();
  }
  if (body.action === "publish") scheduledPublishAt = null;

  const eventSlug = current.eventSlug ?? `${slugify(current.title)}-${current.id.slice(0, 5)}`;
  const update = {
    status: next,
    reviewNote,
    curationNote: curationNote || null,
    scheduledPublishAt,
    publishedAt: body.action === "publish" ? now : current.publishedAt,
    eventSlug: ["approve", "schedule", "publish", "unpublish"].includes(body.action) ? eventSlug : current.eventSlug,
    updatedAt: now,
  };

  const updateSubmission = db.update(partySubmissions).set(update).where(eq(partySubmissions.id, current.id));
  const addAuditEvent = db.insert(curationAuditEvents).values({
    id: crypto.randomUUID(), submissionId: current.id, action: body.action,
    fromStatus: current.status, toStatus: next, note: reviewNote,
    actor: actor.actor, createdAt: now,
  });

  if (["schedule", "publish", "unpublish"].includes(body.action)) {
    const publicStatus = next === "published" ? "published" : next === "scheduled" ? "scheduled" : "unpublished";
    const publishEvent = db.insert(curatedEventRecords).values({
      id: current.id,
      submissionId: current.id,
      slug: eventSlug,
      title: current.title,
      venue: current.venueName,
      area: current.area,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      vibe: current.vibe,
      priceFromMinor: current.priceFromMinor,
      imageUrl: current.posterObjectKey ? `/api/media/${current.id}` : "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88",
      curationNote,
      status: publicStatus,
      scheduledPublishAt,
      publishedAt: next === "published" ? now : current.publishedAt,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: curatedEventRecords.submissionId,
      set: { status: publicStatus, scheduledPublishAt, publishedAt: next === "published" ? now : current.publishedAt, curationNote, updatedAt: now },
    });
    await db.batch([updateSubmission, addAuditEvent, publishEvent]);
  } else {
    await db.batch([updateSubmission, addAuditEvent]);
  }

  return Response.json({ id: current.id, status: next, scheduledPublishAt });
}
