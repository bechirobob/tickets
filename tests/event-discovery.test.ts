import { describe, expect, it } from "vitest";
import { matchesEventWindow } from "../lib/event-discovery";

const event = (startsAt: string, endsAt: string) => ({ startsAt, endsAt, eventState: "on_sale" as const });
describe("Accra event discovery windows", () => {
  it("uses the next Accra calendar day for Tomorrow, including month rollover", () => {
    const now = Date.parse("2026-09-30T23:00:00Z");
    expect(matchesEventWindow(event("2026-10-01T00:00:00Z", "2026-10-01T04:00:00Z"), "tomorrow", now)).toBe(true);
    expect(matchesEventWindow(event("2026-09-30T22:00:00Z", "2026-10-01T04:00:00Z"), "tomorrow", now)).toBe(false);
    expect(matchesEventWindow(event("2026-10-02T00:00:00Z", "2026-10-02T04:00:00Z"), "tomorrow", now)).toBe(false);
  });
  it("matches explicit calendar dates and rejects invalid or undated selections", () => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    const night = event("2026-09-05T22:00:00Z", "2026-09-06T04:00:00Z");
    expect(matchesEventWindow(night, "date", now, "2026-09-05")).toBe(true);
    expect(matchesEventWindow(night, "date", now, "2026-09-06")).toBe(false);
    for (const date of ["", "invalid", "2026-02-30"]) expect(matchesEventWindow(night, "date", now, date)).toBe(false);
    expect(matchesEventWindow({ ...night, startsAt: null }, "date", now, "2026-09-05")).toBe(false);
    expect(matchesEventWindow(night, "date", Date.parse("2026-09-06T05:00:00Z"), "2026-09-05")).toBe(false);
  });
  it("keeps an ongoing night after midnight without including tomorrow's day party", () => {
    const now = Date.parse("2026-09-06T03:00:00Z");
    const ongoing = event("2026-09-05T21:00:00Z", "2026-09-06T05:00:00Z");
    expect(matchesEventWindow(ongoing, "tonight", now)).toBe(true);
    expect(matchesEventWindow(ongoing, "next", now)).toBe(true);
    expect(matchesEventWindow(event("2026-09-06T15:00:00Z", "2026-09-06T23:00:00Z"), "tonight", now)).toBe(false);
  });
  it("keeps This weekend bounded to the current weekend, not next Friday", () => {
    const now = Date.parse("2026-09-05T12:00:00Z");
    expect(matchesEventWindow(event("2026-09-06T15:00:00Z", "2026-09-06T23:00:00Z"), "weekend", now)).toBe(true);
    expect(matchesEventWindow(event("2026-09-11T22:00:00Z", "2026-09-12T04:00:00Z"), "weekend", now)).toBe(false);
  });
  it("does not promote ended or cancelled events", () => {
    const now = Date.parse("2026-09-05T12:00:00Z");
    expect(matchesEventWindow(event("2026-09-04T22:00:00Z", "2026-09-05T04:00:00Z"), "next", now)).toBe(false);
    expect(matchesEventWindow({ ...event("2026-09-05T22:00:00Z", "2026-09-06T04:00:00Z"), eventState: "cancelled" }, "next", now)).toBe(false);
  });
});
