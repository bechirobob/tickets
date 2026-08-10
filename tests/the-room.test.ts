import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const policy = {
  eventSlug: "after-dark-osu",
  eventTitle: "After Dark: Osu",
  startsAt: "2026-08-14T22:00:00.000Z",
  endsAt: "2026-08-15T04:00:00.000Z",
  readOnlyAt: "2026-08-18T04:00:00.000Z",
  readOnly: false,
};

describe("The Room Durable Object", () => {
  it("persists an organiser announcement and supports audited removal", async () => {
    const room = env.THE_ROOM.getByName("event-a");
    const announcement = await room.publishAnnouncement("BeCore Admin", "Doors open at 9:30 PM.", true, policy);

    expect(announcement.kind).toBe("announcement");
    expect(announcement.pinned).toBe(true);
    expect(await room.hasMessage(announcement.id)).toBe(true);
    expect(await room.getMessage(announcement.id)).toMatchObject({
      displayName: "BeCore Host",
      content: "Doors open at 9:30 PM.",
      deletedAt: null,
    });

    expect(await room.removeMessage(announcement.id)).toBe(true);
    expect(await room.hasMessage(announcement.id)).toBe(false);
    expect(await room.getMessage(announcement.id)).toMatchObject({
      content: "Doors open at 9:30 PM.",
    });
  });

  it("isolates conversations by event", async () => {
    const first = env.THE_ROOM.getByName("event-first");
    const second = env.THE_ROOM.getByName("event-second");
    const message = await first.publishAnnouncement("BeCore Admin", "First room only", false, policy);

    expect(await first.hasMessage(message.id)).toBe(true);
    expect(await second.hasMessage(message.id)).toBe(false);
  });
});
