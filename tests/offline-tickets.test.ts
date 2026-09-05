import { describe, expect, it } from "vitest";
import { clearOfflineTickets, OFFLINE_TICKETS_KEY, reconcileOfflineTickets, saveOfflineNight, type OfflineNight } from "../lib/offline-tickets";

function storage() {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } satisfies Storage;
}
const now = Date.parse("2026-09-05T12:00:00Z");
const night: OfflineNight = { slug: "test", title: "Test", fullDate: "Saturday", time: "20:00", venue: "Test", area: "Accra", savedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), tickets: [{ id: "ticket-1", ticketType: "general", gateCode: "TEST", qrImage: "data:image/png;base64,AA==" }] };

describe("offline ticket privacy", () => {
  it("removes transferred or refunded tickets during online reconciliation", () => {
    const target = storage();
    reconcileOfflineTickets("owner", ["ticket-1"], target, now);
    saveOfflineNight("owner", night, target, now);
    reconcileOfflineTickets("owner", [], target, now);
    expect(JSON.parse(target.getItem(OFFLINE_TICKETS_KEY)!).nights).toEqual([]);
  });
  it("clears another account's copies and cannot resurrect them after sign-out", () => {
    const target = storage();
    reconcileOfflineTickets("owner", ["ticket-1"], target, now);
    saveOfflineNight("owner", night, target, now);
    reconcileOfflineTickets("other", ["ticket-1"], target, now);
    saveOfflineNight("owner", night, target, now);
    expect(JSON.parse(target.getItem(OFFLINE_TICKETS_KEY)!).nights).toEqual([]);
    clearOfflineTickets(target);
    saveOfflineNight("other", night, target, now);
    expect(target.getItem(OFFLINE_TICKETS_KEY)).toBeNull();
  });
  it("expires stale copies and removes legacy unscoped storage", () => {
    const target = storage();
    target.setItem("bct:offline-tickets:v1", "[]");
    reconcileOfflineTickets("owner", ["ticket-1"], target, now);
    saveOfflineNight("owner", night, target, now);
    reconcileOfflineTickets("owner", ["ticket-1"], target, now + 2 * 86_400_000);
    expect(target.getItem("bct:offline-tickets:v1")).toBeNull();
    expect(JSON.parse(target.getItem(OFFLINE_TICKETS_KEY)!).nights).toEqual([]);
  });
});
