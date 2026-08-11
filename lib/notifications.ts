import { sendNotification, type PushSubscription } from "web-push-neo";

type NotificationKind = "room_message" | "host_update" | "ticket_transfer" | "gate_update" | "event_reminder" | "test" | "waitlist_offer" | "payment_recovery" | "event_status" | "support_update";

type PushRow = {
  attendeeId: string;
  subscriptionId: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export type NotificationPayload = {
  eventSlug?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  sourceId?: string | null;
  tag?: string;
};

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function deliverPush(env: Cloudflare.Env, row: PushRow, payload: NotificationPayload): Promise<boolean> {
  if (!row.subscriptionId || !row.endpoint || !row.p256dh || !row.auth) return false;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return false;
  const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } satisfies PushSubscription;
  try {
    await sendNotification(subscription, JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      eventSlug: payload.eventSlug ?? null,
      kind: payload.kind,
      tag: payload.tag ?? `bct-${payload.kind}`,
    }), {
      vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
      TTL: payload.kind === "room_message" ? 15 * 60 : 24 * 60 * 60,
      urgency: payload.kind === "room_message" ? "normal" : "high",
      topic: (payload.tag ?? `bct-${payload.kind}`).replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 32),
      signal: AbortSignal.timeout(7_000),
    });
    await env.DB.prepare("UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), row.subscriptionId).run();
    return true;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
    await env.DB.prepare(`
      UPDATE push_subscriptions
      SET failure_count = failure_count + 1,
          revoked_at = CASE WHEN ? IN (404, 410) THEN ? ELSE revoked_at END,
          updated_at = ?
      WHERE id = ?
    `).bind(status, new Date().toISOString(), new Date().toISOString(), row.subscriptionId).run();
    console.error(JSON.stringify({ message: "push delivery failed", status, subscriptionId: row.subscriptionId }));
    return false;
  }
}

async function persistAndPush(env: Cloudflare.Env, recipients: PushRow[], payload: NotificationPayload): Promise<number> {
  const now = new Date().toISOString();
  const uniqueAttendees = [...new Set(recipients.map((row) => row.attendeeId))];
  for (const batch of chunks(uniqueAttendees, 50)) {
    await env.DB.batch(batch.map((attendeeId) => env.DB.prepare(`
      INSERT OR IGNORE INTO attendee_notifications
        (id, attendee_id, event_slug, kind, title, body, url, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), attendeeId, payload.eventSlug ?? null, payload.kind,
      payload.title.slice(0, 120), payload.body.slice(0, 280), payload.url.slice(0, 300),
      payload.sourceId ?? null, now,
    )));
  }
  let delivered = 0;
  for (const batch of chunks(recipients.filter((row) => row.subscriptionId), 20)) {
    const results = await Promise.all(batch.map((row) => deliverPush(env, row, payload)));
    delivered += results.filter(Boolean).length;
  }
  return delivered;
}

export async function notifyRoomMessage(env: Cloudflare.Env, input: {
  eventSlug: string;
  messageId: string;
  senderAttendeeId: string;
  senderName: string;
  content: string;
  announcement?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`
    SELECT DISTINCT assignment.attendee_id AS attendeeId,
           subscription.id AS subscriptionId, subscription.endpoint,
           subscription.p256dh, subscription.auth
    FROM ticket_assignments assignment
    JOIN tickets ticket ON ticket.id = assignment.ticket_id
    LEFT JOIN notification_preferences preference
      ON preference.attendee_id = assignment.attendee_id AND preference.event_slug = ticket.event_slug
    LEFT JOIN push_subscriptions subscription
      ON subscription.attendee_id = assignment.attendee_id AND subscription.revoked_at IS NULL
    WHERE ticket.event_slug = ? AND assignment.status = 'active'
      AND ticket.status IN ('issued', 'checked_in')
      AND assignment.attendee_id <> ?
      AND COALESCE(preference.room_messages, 1) = 1
      AND (preference.muted_until IS NULL OR preference.muted_until <= ?)
    LIMIT 2500
  `).bind(input.eventSlug, input.senderAttendeeId, now).all<PushRow>();
  if (!rows.results.length) return;
  const body = input.content.length > 110 ? `${input.content.slice(0, 107)}…` : input.content;
  await persistAndPush(env, rows.results, {
    eventSlug: input.eventSlug,
    kind: input.announcement ? "host_update" : "room_message",
    title: input.announcement ? "The Host has spoken" : `${input.senderName} is in The Room`,
    body,
    url: `/room/${encodeURIComponent(input.eventSlug)}?from=notification`,
    sourceId: input.messageId,
    tag: `room-${input.eventSlug}`,
  });
}

export async function notifyAttendee(env: Cloudflare.Env, attendeeId: string, payload: NotificationPayload): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT ? AS attendeeId, id AS subscriptionId, endpoint, p256dh, auth
    FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL LIMIT 12
  `).bind(attendeeId, attendeeId).all<PushRow>();
  await persistAndPush(env, rows.results.length ? rows.results : [{ attendeeId, subscriptionId: null, endpoint: null, p256dh: null, auth: null }], payload);
}

export async function notifyAttendeeDevice(env: Cloudflare.Env, attendeeId: string, endpoint: string, payload: NotificationPayload): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT attendee_id AS attendeeId, id AS subscriptionId, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE attendee_id = ? AND endpoint = ? AND revoked_at IS NULL LIMIT 1
  `).bind(attendeeId, endpoint).first<PushRow>();
  if (!row) return false;
  return (await persistAndPush(env, [row], payload)) === 1;
}

export async function notifyEventAttendees(env: Cloudflare.Env, eventSlug: string, payload: NotificationPayload): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT assignment.attendee_id AS attendeeId,
      subscription.id AS subscriptionId, subscription.endpoint, subscription.p256dh, subscription.auth
    FROM ticket_assignments assignment JOIN tickets ticket ON ticket.id = assignment.ticket_id
    LEFT JOIN push_subscriptions subscription ON subscription.attendee_id = assignment.attendee_id AND subscription.revoked_at IS NULL
    WHERE assignment.status = 'active' AND ticket.event_slug = ?
      AND ticket.status IN ('issued', 'checked_in', 'voided', 'refunded') LIMIT 2500
  `).bind(eventSlug).all<PushRow>();
  if (rows.results.length) await persistAndPush(env, rows.results, { ...payload, eventSlug });
}
