import type { CuratedEvent } from "../app/events";

export type PublicHost = {
  id: string;
  slug: string;
  name: string;
  bio: string;
  city: string;
  verificationStatus: "verified" | "reviewed" | "unverified";
  profileImageUrl: string | null;
  role: string;
};

export type EventQuestion = {
  id: string;
  prompt: string;
  kind: "text" | "choice";
  options: string[];
  required: boolean;
  answer: string;
};

export type EventUpdate = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  publishedBy: string;
};

export type EventMemory = { id: string; title: string; body: string; imageUrl: string | null; publishedAt: string; publishedBy: string };

type HostRecord = Omit<PublicHost, "role"> & { role?: string | null };

function safeOptions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

export async function findPrimaryHost(db: D1Database, eventSlug: string): Promise<PublicHost | null> {
  const host = await db.prepare(`
    SELECT host.id, host.slug, host.name, host.bio, host.city,
           host.verification_status AS verificationStatus,
           host.profile_image_url AS profileImageUrl, link.role
    FROM event_hosts link
    JOIN hosts host ON host.id = link.host_id
    WHERE link.event_slug = ?
    ORDER BY link.is_primary DESC, host.name
    LIMIT 1
  `).bind(eventSlug).first<HostRecord>();
  return host ? { ...host, role: host.role ?? "Host" } : null;
}

export async function findHostBySlug(db: D1Database, slug: string): Promise<PublicHost | null> {
  if (!/^[a-z0-9-]{1,80}$/u.test(slug)) return null;
  const host = await db.prepare(`
    SELECT id, slug, name, bio, city, verification_status AS verificationStatus,
           profile_image_url AS profileImageUrl
    FROM hosts WHERE slug = ? LIMIT 1
  `).bind(slug).first<HostRecord>();
  return host ? { ...host, role: "Host" } : null;
}

export async function listHostEventSlugs(db: D1Database, hostId: string): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT event_slug AS eventSlug FROM event_hosts
    WHERE host_id = ? ORDER BY created_at DESC LIMIT 100
  `).bind(hostId).all<{ eventSlug: string }>();
  return rows.results.map((row) => row.eventSlug);
}

export async function listEventHosts(db: D1Database, eventSlugs: string[]): Promise<Map<string, PublicHost>> {
  if (!eventSlugs.length) return new Map();
  const placeholders = eventSlugs.map(() => "?").join(",");
  const rows = await db.prepare(`
    SELECT link.event_slug AS eventSlug, host.id, host.slug, host.name, host.bio, host.city,
           host.verification_status AS verificationStatus,
           host.profile_image_url AS profileImageUrl, link.role
    FROM event_hosts link
    JOIN hosts host ON host.id = link.host_id
    WHERE link.event_slug IN (${placeholders})
    ORDER BY link.is_primary DESC, host.name
  `).bind(...eventSlugs).all<HostRecord & { eventSlug: string }>();
  const result = new Map<string, PublicHost>();
  for (const row of rows.results) {
    if (!result.has(row.eventSlug)) result.set(row.eventSlug, { ...row, role: row.role ?? "Host" });
  }
  return result;
}

export async function loadTicketedEventExperience(
  db: D1Database,
  attendeeId: string,
  eventSlug: string,
): Promise<{
  preference: { attendeeVisible: boolean; keepPosted: boolean };
  questions: EventQuestion[];
  updates: EventUpdate[];
  memories: EventMemory[];
  visibleAttendees: number;
}> {
  const [preference, questions, updates, memories, visibleCount] = await Promise.all([
    db.prepare(`
      SELECT
        COALESCE(
          (SELECT attendee_visible FROM attendee_event_preferences WHERE attendee_id = ? AND event_slug = ? LIMIT 1),
          (SELECT default_attendee_visible FROM attendee_privacy_settings WHERE attendee_id = ? LIMIT 1),
          false
        ) AS attendeeVisible,
        COALESCE(
          (SELECT keep_posted FROM attendee_event_preferences WHERE attendee_id = ? AND event_slug = ? LIMIT 1),
          false
        ) AS keepPosted
    `).bind(attendeeId, eventSlug, attendeeId, attendeeId, eventSlug).first<{ attendeeVisible: number; keepPosted: number }>(),
    db.prepare(`
      SELECT question.id, question.prompt, question.kind, question.options_json AS optionsJson,
             question.required, COALESCE(answer.answer, '') AS answer
      FROM event_questions question
      LEFT JOIN attendee_question_answers answer
        ON answer.question_id = question.id AND answer.attendee_id = ?
      WHERE question.event_slug = ? AND question.status = 'active'
      ORDER BY question.sort_order, question.created_at
    `).bind(attendeeId, eventSlug).all<{ id: string; prompt: string; kind: "text" | "choice"; optionsJson: string | null; required: number; answer: string }>(),
    db.prepare(`
      SELECT id, title, body, pinned, published_at AS publishedAt, published_by AS publishedBy
      FROM event_updates WHERE event_slug = ? ORDER BY pinned DESC, published_at DESC LIMIT 50
    `).bind(eventSlug).all<{ id: string; title: string; body: string; pinned: number; publishedAt: string; publishedBy: string }>(),
    db.prepare(`SELECT id, title, body, image_url AS imageUrl, published_at AS publishedAt, published_by AS publishedBy
      FROM event_memories WHERE event_slug = ? ORDER BY published_at DESC LIMIT 24`).bind(eventSlug).all<EventMemory>(),
    db.prepare(`
      SELECT COUNT(*) AS count FROM attendee_event_preferences
      WHERE event_slug = ? AND attendee_visible = true
    `).bind(eventSlug).first<{ count: number }>(),
  ]);
  return {
    preference: { attendeeVisible: Boolean(preference?.attendeeVisible), keepPosted: Boolean(preference?.keepPosted) },
    questions: questions.results.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      options: safeOptions(question.optionsJson),
      required: Boolean(question.required),
      answer: question.answer,
    })),
    updates: updates.results.map((update) => ({ ...update, pinned: Boolean(update.pinned) })),
    memories: memories.results,
    visibleAttendees: visibleCount?.count ?? 0,
  };
}

export function eventTiming(event: Pick<CuratedEvent, "startsAt" | "endsAt">, now = Date.now()): "upcoming" | "live" | "past" {
  if (new Date(event.startsAt).getTime() > now) return "upcoming";
  if (new Date(event.endsAt).getTime() >= now) return "live";
  return "past";
}
