import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { refreshExpiredPreviewEvents } from "../lib/preview-events";

describe("working preview events", () => {
  it("keeps three preview events after publishing the guest list", async () => {
    const events = await env.DB.prepare(`
      SELECT slug, is_test_event AS isTestEvent
      FROM curated_event_records
      WHERE is_test_event = 1 AND status = 'published'
      ORDER BY slug
    `).all<{ slug: string; isTestEvent: number }>();
    const tiers = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM event_ticket_tiers
      WHERE event_slug IN ('after-dark-osu', 'noir-room-labone', 'sun-chasers-labadi', 'longitude-spintex')
    `).first<{ count: number }>();

    expect(events.results.map((event) => event.slug)).toEqual([
      "after-dark-osu",
      "longitude-spintex",
      "noir-room-labone",
    ]);
    expect(events.results.every((event) => event.isTestEvent === 1)).toBe(true);
    expect(tiers?.count).toBe(12);
  });

  it("rolls expired preview dates forward without creating duplicate inventory", async () => {
    const expiredNow = new Date("2026-09-01T08:00:00.000Z");
    const updated = await refreshExpiredPreviewEvents(env.DB, expiredNow);
    const afterDark = await env.DB.prepare(`
      SELECT starts_at AS startsAt, ends_at AS endsAt
      FROM curated_event_records
      WHERE slug = 'after-dark-osu'
    `).first<{ startsAt: string; endsAt: string }>();
    const tierCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM event_ticket_tiers WHERE event_slug = 'after-dark-osu'
    `).first<{ count: number }>();

    expect(updated).toBe(3);
    expect(new Date(afterDark?.startsAt ?? 0).getTime()).toBeGreaterThan(expiredNow.getTime());
    expect(new Date(afterDark?.endsAt ?? 0).getTime()).toBeGreaterThan(new Date(afterDark?.startsAt ?? 0).getTime());
    expect(tierCount?.count).toBe(3);
  });

  it("keeps the published guest list date fixed after it ends", async () => {
    await refreshExpiredPreviewEvents(env.DB, new Date("2026-10-11T08:00:00.000Z"));
    const event = await env.DB.prepare(`
      SELECT starts_at, ends_at, is_test_event, status, curation_note, dress_code, colour_scheme, awareness_note, guest_perk
      FROM curated_event_records WHERE slug = 'sun-chasers-labadi'
    `).first();
    expect(event).toMatchObject({
      starts_at: "2026-10-04T14:00:00.000Z",
      ends_at: "2026-10-04T22:00:00.000Z",
      is_test_event: 0,
      status: "published",
      dress_code: "Light pink & white",
      colour_scheme: "blush",
      awareness_note: "In support of Breast Cancer Awareness Month",
      guest_perk: "Clink early. Free mimosas till 5 PM.",
    });
    expect(event?.curation_note).toContain("Free mimosas till 5 PM.");
    const placeholderHost = await env.DB.prepare("SELECT host_id FROM event_hosts WHERE event_slug = 'sun-chasers-labadi' AND host_id = 'host:becore-preview-desk'").first();
    expect(placeholderHost).toBeNull();
  });
});
