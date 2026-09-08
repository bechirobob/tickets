import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { normalizeEventTagline, assertOriginalEventTagline } from "../lib/event-copy";
import { getPublicEvents } from "../app/events";
import { PATCH as saveEvent } from "../app/api/admin/events/route";
import { adminCookieHeader, createStaffSession } from "../lib/admin-session";

describe("individual event copy", () => {
  it("keeps both launch lines specific and different", async () => {
    const events = await getPublicEvents();
    expect(events.find((event) => event.slug === "the-weekend-braai")?.quip).toBe("Grills on. You’re off duty.");
    expect(events.find((event) => event.slug === "sun-chasers-labadi")?.quip).toBe("A little pink. A very good excuse.");
    expect(new Set(events.map((event) => event.quip)).size).toBe(events.length);
  });

  it("requires original copy for publication and normalizes whitespace", async () => {
    expect(normalizeEventTagline("  Come hungry.\n Leave happy.  ", true)).toBe("Come hungry. Leave happy.");
    expect(() => normalizeEventTagline("", true)).toThrow("original event line");
    expect(() => normalizeEventTagline("a".repeat(101), true)).toThrow();
    await expect(assertOriginalEventTagline(env.DB, "GRILLS ON. YOU’RE OFF DUTY.", "another-event")).rejects.toThrow("another event");
    await expect(assertOriginalEventTagline(env.DB, "Grills on. You’re off duty.", "the-weekend-braai")).resolves.toBeUndefined();
  });

  it("never invents a category slogan for an event without editorial copy", async () => {
    await env.DB.prepare("UPDATE curated_event_records SET tagline = NULL WHERE slug = 'sun-chasers-labadi'").run();
    const events = await getPublicEvents();
    expect(events.find((event) => event.slug === "sun-chasers-labadi")?.quip).toBe("");
    await env.DB.prepare("UPDATE curated_event_records SET tagline = 'A little pink. A very good excuse.' WHERE slug = 'sun-chasers-labadi'").run();
  });

  it("enforces uniqueness atomically in storage", async () => {
    await expect(env.DB.prepare("UPDATE curated_event_records SET tagline = '  GRILLS ON. YOU’RE OFF DUTY.  ' WHERE slug = 'sun-chasers-labadi'").run()).rejects.toThrow();
  });

  it("lets staff edit a coming-soon event line without inventing dates or inventory", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at) VALUES ('copy-editor', 'copy-editor@example.com', 'Copy editor', 'owner', 'test-hash', 'test-salt', 100000, 0, 'active', 0, ?, ?, 'test', ?)").bind(now, now, now).run();
    const token = await createStaffSession(env.DB, { id: "copy-editor" });
    const cookie = adminCookieHeader(token).split(";")[0];
    const request = (tagline: string, authenticated = true) => new Request("https://tickets.becoreops.com/api/admin/events", { method: "PATCH", headers: { origin: "https://tickets.becoreops.com", "content-type": "application/json", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify({ action: "save_copy", slug: "sun-chasers-labadi", tagline }) });
    expect((await saveEvent(request("Pink looks good on this guest list.", false))).status).toBe(403);
    expect((await saveEvent(request("Grills on. You’re off duty."))).status).toBe(400);
    expect((await saveEvent(request("Pink looks good on this guest list."))).status).toBe(200);
    expect(await env.DB.prepare("SELECT tagline, schedule_status, capacity FROM curated_event_records WHERE slug = 'sun-chasers-labadi'").first()).toMatchObject({ tagline: "Pink looks good on this guest list.", schedule_status: "coming_soon" });
    await env.DB.prepare("UPDATE curated_event_records SET tagline = 'A little pink. A very good excuse.' WHERE slug = 'sun-chasers-labadi'").run();
  });
});
