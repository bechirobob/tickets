import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { deliverQueuedEventAnnouncement, queueEventAnnouncement } from "../lib/event-announcement-queue";

afterEach(() => vi.unstubAllGlobals());

it("queues only the delivery id and does not call the email provider inline", async () => {
  const deliveryId = `event-announcement/${crypto.randomUUID()}/${crypto.randomUUID()}`;
  const send = vi.fn(async (body: { deliveryId: string }) => {
    expect(body).toEqual({ deliveryId });
  });
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);

  const queuedEnv = {
    DB: env.DB,
    EMAIL_DELIVERY_QUEUE: { send },
    RESEND_API_KEY: "re_test_delivery",
    EMAIL_FROM: "BeCore Tickets <tickets@tickets.becoreops.com>",
  } as unknown as Cloudflare.Env;

  const result = await queueEventAnnouncement(queuedEnv, {
    deliveryId,
    recipient: "audience@example.com",
    subject: "A night update",
    html: "<p>Doors at 9.</p>",
    text: "Doors at 9.",
    idempotencyKey: deliveryId,
  });

  expect(result).toEqual({ queued: true });
  expect(send).toHaveBeenCalledTimes(1);
  expect(provider).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT status,attempt_count AS attemptCount FROM delivery_events WHERE id=?").bind(deliveryId).first())
    .toEqual({ status: "queued", attemptCount: 0 });
});

it("delivers a queued announcement once and keeps consent authoritative in D1", async () => {
  const campaignId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const deliveryId = `event-announcement/${campaignId}/${contactId}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_audience_contacts (
      id,event_slug,email,guest_name,source,consented_at,unsubscribe_token,confirmed_at
    ) VALUES (?, 'the-weekend-braai', 'queue-fixture@example.com', 'Queue Fixture', 'test', ?, ?, ?)
  `).bind(contactId, now, crypto.randomUUID(), now).run();

  const queueSend = vi.fn(async () => undefined);
  const queuedEnv = {
    DB: env.DB,
    EMAIL_DELIVERY_QUEUE: { send: queueSend },
    RESEND_API_KEY: "re_test_delivery",
    EMAIL_FROM: "BeCore Tickets <tickets@tickets.becoreops.com>",
  } as unknown as Cloudflare.Env;

  await queueEventAnnouncement(queuedEnv, {
    deliveryId,
    recipient: "queue-fixture@example.com",
    subject: "Braai update",
    html: "<p>Doors at 2.</p>",
    text: "Doors at 2.",
    idempotencyKey: deliveryId,
  });

  const provider = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(deliveryId);
    return Response.json({ id: "queued-provider-id" });
  });
  vi.stubGlobal("fetch", provider);

  expect(await deliverQueuedEventAnnouncement(queuedEnv, deliveryId)).toEqual({ handled: true, providerId: "queued-provider-id" });
  expect(await deliverQueuedEventAnnouncement(queuedEnv, deliveryId)).toEqual({ handled: true, reason: "already_handled" });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT status,provider_id AS providerId FROM delivery_events WHERE id=?").bind(deliveryId).first())
    .toEqual({ status: "sent", providerId: "queued-provider-id" });
});

it("rejects malformed queue messages without touching the provider", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const queuedEnv = {
    DB: env.DB,
    RESEND_API_KEY: "re_test_delivery",
    EMAIL_FROM: "BeCore Tickets <tickets@tickets.becoreops.com>",
  } as unknown as Cloudflare.Env;

  expect(await deliverQueuedEventAnnouncement(queuedEnv, "not-an-announcement")).toEqual({ handled: true, reason: "invalid_id" });
  expect(provider).not.toHaveBeenCalled();
});
