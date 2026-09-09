import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { refreshExpiredPreviewEvents } from "../lib/preview-events";
import { findCuratedEvent, getPublicEvents } from "../app/events";
import { GET as calendar } from "../app/api/calendar/[slug]/route";
import { POST as payment } from "../app/api/payments/initialize/route";
import { matchesEventWindow } from "../lib/event-discovery";

const origin = "https://tickets.becoreops.com";
const calendarFor = (slug: string) => calendar(new Request(`${origin}/api/calendar/${slug}`), { params: Promise.resolve({ slug }) });

describe("launch event inventory", () => {
  it("publishes exactly two real listings and preserves retired inventory", async () => {
    expect((await getPublicEvents()).map((event) => event.slug)).toEqual(["the-weekend-braai", "sun-chasers-labadi"]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM curated_event_records WHERE is_test_event = 1 AND status = 'published'").first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_ticket_tiers").first()).toEqual({ count: 12 });
    for (const slug of ["after-dark-osu", "longitude-spintex", "noir-room-labone"]) {
      expect(await findCuratedEvent(slug)).toBeNull();
      expect((await calendarFor(slug)).status).toBe(404);
    }
  });
  it("never republishes retired previews during the daily rollover", async () => {
    expect(await refreshExpiredPreviewEvents(env.DB, new Date("2027-01-01"))).toBe(0);
    expect((await getPublicEvents()).map((event) => event.slug)).toEqual(["the-weekend-braai", "sun-chasers-labadi"]);
  });
  it("redacts Guest List dates and keeps coming-soon events discoverable", async () => {
    const event = await findCuratedEvent("sun-chasers-labadi");
    expect(event).toMatchObject({ startsAt: null, endsAt: null, rescheduledFrom: null, salesOpenAt: null, salesCloseAt: null, fullDate: "Coming soon", scheduleStatus: "coming_soon", dressCode: "Light pink & white", isVerified: true });
    expect(JSON.stringify(event)).not.toMatch(/2026-10-04|2026-09-13/);
    expect(event?.note).not.toContain("first Sunday");
    expect(event?.ticketTiers.every((tier) => tier.status === "hidden")).toBe(true);
    expect(matchesEventWindow(event!, "next", Date.parse("2027-01-01"))).toBe(true);
    expect(matchesEventWindow(event!, "tonight", Date.now())).toBe(false);
    expect(matchesEventWindow(event!, "weekend", Date.now())).toBe(false);
    expect((await calendarFor("sun-chasers-labadi")).status).toBe(404);
  });
  it("uses flier-backed Braai facts without invented stock or closing time", async () => {
    const event = await findCuratedEvent("the-weekend-braai");
    expect(event).toMatchObject({ startsAt: "2026-09-20T14:00:00.000Z", endsAt: null, priceFromMinor: 35000, capacity: 0, ticketTiers: [], scheduleStatus: "end_pending", isVerified: true, image: "/events/the-weekend-braai.jpeg" });
    expect(new Date(event!.startsAt!).getUTCDay()).toBe(0);
    const response = await calendarFor(event!.slug);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const ics = await response.text();
    expect(ics).toContain("DTSTART:20260920T140000Z");
    expect(ics).not.toContain("DTEND");
  });
  it("blocks direct payment attempts for pending listings and retired previews", async () => {
    const provider = vi.spyOn(globalThis, "fetch");
    try {
      for (const slug of ["sun-chasers-labadi", "the-weekend-braai", "after-dark-osu"]) {
        const response = await payment(new Request(`${origin}/api/payments/initialize`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ eventSlug: slug, ticketTierId: "general", quantity: 1, email: "launch@example.com", phone: "233000000000", acceptedPolicies: true }) }));
        expect(response.status).toBe(400);
      }
      expect(provider).not.toHaveBeenCalled();
    } finally { provider.mockRestore(); }
  });
});
