import { sendEmail } from "./email-delivery";

type EventAnnouncementInput = {
  deliveryId: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

type SavedPayload = {
  subject?: string;
  html?: string;
  text?: string;
  idempotencyKey?: string;
};

function quotaRetryAt(response: Response, name?: string) {
  if (name === "daily_quota_exceeded") {
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 1, 0, 0);
    return next.toISOString();
  }
  if (name === "monthly_quota_exceeded") return new Date(Date.now() + 86_400_000).toISOString();
  const seconds = Number(response.headers.get("retry-after"));
  return new Date(Date.now() + Math.max(60, Number.isFinite(seconds) ? Math.min(seconds, 86_400) : 60) * 1000).toISOString();
}

export async function queueEventAnnouncement(env: Cloudflare.Env, input: EventAnnouncementInput) {
  // Local/test environments may not have Queues. Preserve current behaviour there
  // rather than making the delivery system depend on production-only bindings.
  if (!env.EMAIL_DELIVERY_QUEUE) {
    return sendEmail({
      db: env.DB,
      kind: "event_announcement",
      deliveryId: input.deliveryId,
      recipient: input.recipient,
      subject: input.subject,
      html: input.html,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
    });
  }

  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO delivery_events (
      id, kind, recipient, status, attempt_count, payload_json, created_at, updated_at
    ) VALUES (?, 'event_announcement', ?, 'queued', 0, ?, ?, ?)
  `).bind(
    input.deliveryId,
    input.recipient,
    JSON.stringify({
      subject: input.subject,
      html: input.html,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
    }),
    now,
    now,
  ).run();

  if (!inserted.meta.changes) return { queued: false, reason: "already_queued" as const };

  try {
    await env.EMAIL_DELIVERY_QUEUE.send({ deliveryId: input.deliveryId });
    return { queued: true };
  } catch (error) {
    const failedAt = new Date();
    await env.DB.prepare(`
      UPDATE delivery_events
      SET status='failed', attempt_count=0, failure_reason=?, next_attempt_at=?, updated_at=?
      WHERE id=? AND status='queued'
    `).bind(
      `Queue publish failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 430)}`,
      new Date(failedAt.getTime() + 60_000).toISOString(),
      failedAt.toISOString(),
      input.deliveryId,
    ).run();
    return { queued: false, reason: "queue_error" as const };
  }
}

export async function deliverQueuedEventAnnouncement(env: Cloudflare.Env, deliveryId: string) {
  if (!/^event-announcement\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u.test(deliveryId)) return { handled: true, reason: "invalid_id" as const };

  const row = await env.DB.prepare(`
    SELECT id, recipient, status, attempt_count AS attemptCount, payload_json AS payloadJson
    FROM delivery_events
    WHERE id=? AND kind='event_announcement'
    LIMIT 1
  `).bind(deliveryId).first<{
    id: string;
    recipient: string;
    status: string;
    attemptCount: number;
    payloadJson: string | null;
  }>();

  if (!row) return { handled: true, reason: "missing" as const };
  if (row.status !== "queued") return { handled: true, reason: "already_handled" as const };

  const claimedAt = new Date().toISOString();
  const claim = await env.DB.prepare(`
    UPDATE delivery_events
    SET failure_reason='queue-processing', updated_at=?
    WHERE id=? AND status='queued'
      AND (failure_reason IS NULL OR failure_reason <> 'queue-processing' OR julianday(updated_at) < julianday('now','-30 seconds'))
  `).bind(claimedAt, deliveryId).run();
  if (!claim.meta.changes) return { handled: true, reason: "leased" as const };

  let payload: SavedPayload;
  try {
    payload = JSON.parse(row.payloadJson ?? "{}") as SavedPayload;
  } catch {
    payload = {};
  }
  if (!payload.subject || !payload.html || !payload.text || !payload.idempotencyKey) {
    await env.DB.prepare(`
      UPDATE delivery_events
      SET status='failed', attempt_count=3, failure_reason='Saved delivery payload is incomplete.', next_attempt_at=NULL, updated_at=?
      WHERE id=?
    `).bind(new Date().toISOString(), deliveryId).run();
    return { handled: true, reason: "invalid_payload" as const };
  }

  const [, campaignId, contactId] = payload.idempotencyKey.split("/");
  if (!campaignId || !contactId) {
    await env.DB.prepare(`
      UPDATE delivery_events
      SET status='failed', attempt_count=3, failure_reason='Announcement delivery key is invalid.', next_attempt_at=NULL, updated_at=?
      WHERE id=?
    `).bind(new Date().toISOString(), deliveryId).run();
    return { handled: true, reason: "invalid_payload" as const };
  }

  const allowed = await env.DB.prepare(`
    SELECT 1
    FROM event_audience_contacts a
    JOIN curated_event_records e ON e.slug=a.event_slug
    WHERE a.id=?
      AND a.consented_at IS NOT NULL
      AND a.consented_at > COALESCE(a.unsubscribed_at,'')
      AND e.removed_at IS NULL
  `).bind(contactId).first();

  if (!allowed) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE delivery_events SET status='suppressed',failure_reason=NULL,next_attempt_at=NULL,updated_at=? WHERE id=?").bind(now, deliveryId),
      env.DB.prepare("UPDATE event_announcement_recipients SET status='skipped' WHERE campaign_id=? AND contact_id=?").bind(campaignId, contactId),
    ]);
    return { handled: true, reason: "suppressed" as const };
  }

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    const now = new Date();
    await env.DB.prepare(`
      UPDATE delivery_events
      SET status='failed', failure_reason='Transactional email is not configured.', next_attempt_at=?, updated_at=?
      WHERE id=?
    `).bind(new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString(), deliveryId).run();
    return { handled: true, reason: "not_configured" as const };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": payload.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [row.recipient],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });
    const result = await response.json() as { id?: string; name?: string; message?: string; error?: { message?: string } };
    const now = new Date();

    if (response.status === 429) {
      await env.DB.prepare(`
        UPDATE delivery_events
        SET status='failed', attempt_count=0, next_attempt_at=?, failure_reason=?, updated_at=?
        WHERE id=?
      `).bind(
        quotaRetryAt(response, result.name),
        result.message ?? "Email provider quota reached.",
        now.toISOString(),
        deliveryId,
      ).run();
      return { handled: true, reason: "provider_quota" as const };
    }

    if (!response.ok || !result.id) {
      const attempts = row.attemptCount + 1;
      await env.DB.prepare(`
        UPDATE delivery_events
        SET status='failed', attempt_count=?, failure_reason=?, next_attempt_at=?, updated_at=?
        WHERE id=?
      `).bind(
        attempts,
        (result.message ?? result.error?.message ?? "Email provider rejected the message.").slice(0, 500),
        attempts < 3 ? new Date(now.getTime() + attempts * 5 * 60_000).toISOString() : null,
        now.toISOString(),
        deliveryId,
      ).run();
      return { handled: true, reason: "provider_error" as const };
    }

    const saved = await env.DB.prepare(`
      UPDATE delivery_events
      SET status='sent', provider_id=?, attempt_count=attempt_count+1, failure_reason=NULL, next_attempt_at=NULL, updated_at=?
      WHERE id=? AND status='queued'
    `).bind(result.id, now.toISOString(), deliveryId).run();
    if (!saved.meta.changes) throw new Error("Delivery state changed before provider result could be saved.");
    return { handled: true, providerId: result.id };
  } catch (error) {
    const failedAt = new Date();
    try {
      const attempts = row.attemptCount + 1;
      await env.DB.prepare(`
        UPDATE delivery_events
        SET status='failed', attempt_count=?, failure_reason=?, next_attempt_at=?, updated_at=?
        WHERE id=? AND status='queued'
      `).bind(
        attempts,
        (error instanceof Error ? error.message : String(error)).slice(0, 500),
        attempts < 3 ? new Date(failedAt.getTime() + attempts * 5 * 60_000).toISOString() : null,
        failedAt.toISOString(),
        deliveryId,
      ).run();
      return { handled: true, reason: "provider_error" as const };
    } catch {
      // If D1 itself is unavailable, leave the queue-processing lease in place.
      // The Queue retry can reclaim it after 30 seconds, and Resend's stable
      // idempotency key protects against a duplicate provider send.
      throw error;
    }
  }
}
