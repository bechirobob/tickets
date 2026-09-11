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
