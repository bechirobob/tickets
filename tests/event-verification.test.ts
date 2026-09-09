import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getPublicEvents } from "../app/events";

async function insertEvent(id: string, status: string, preview = 0) {
  await env.DB.prepare(`INSERT INTO curated_event_records
    (id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe, price_from_minor,
     image_url, curation_note, status, is_test_event, created_at, updated_at)
    VALUES (?, ?, ?, 'Verification fixture', 'Venue', 'Accra', '2027-01-01', '2027-01-02',
     'Day party', 0, '/events/the-weekend-braai.jpeg', 'Reviewed', ?, ?, '2026-09-09', '2026-09-09')`)
    .bind(id, id, id, status, preview).run();
}
const verification = (id: string) => env.DB.prepare("SELECT is_verified FROM curated_event_records WHERE id = ?").bind(id).first<number>("is_verified");

describe("verified public listings", () => {
  it("verifies both current launch events", async () => {
    const events = await getPublicEvents();
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.isVerified)).toBe(true);
  });

  it("automatically verifies new manual and scheduled production listings", async () => {
    for (const status of ["published", "scheduled"]) {
      await insertEvent(`verified-${status}`, status);
      expect(await verification(`verified-${status}`)).toBe(1);
    }
  });

  it("verifies publication transitions without granting verification to drafts or previews", async () => {
    await insertEvent("verification-draft", "unpublished");
    await insertEvent("verification-preview", "published", 1);
    expect(await verification("verification-draft")).toBe(0);
    expect(await verification("verification-preview")).toBe(0);
    await env.DB.prepare("UPDATE curated_event_records SET status = 'scheduled' WHERE id = 'verification-draft'").run();
    expect(await verification("verification-draft")).toBe(1);
    await env.DB.prepare("UPDATE curated_event_records SET is_test_event = 0 WHERE id = 'verification-preview'").run();
    expect(await verification("verification-preview")).toBe(1);
    await env.DB.prepare("UPDATE curated_event_records SET is_verified = 0 WHERE id = 'verification-preview'").run();
    expect(await verification("verification-preview")).toBe(1);
  });
});
