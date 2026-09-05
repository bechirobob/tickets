import type { CuratedEvent } from "../app/events";

export type EventWindow = "tonight" | "weekend" | "next";

export function matchesEventWindow(event: Pick<CuratedEvent, "startsAt" | "endsAt" | "eventState">, filter: EventWindow, now: number) {
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || event.eventState === "cancelled" || event.eventState === "postponed") return false;
  if (filter === "next") return true;
  // Accra uses UTC. A night rolls over at 06:00, retaining after-midnight sets.
  const nightDate = new Date(now - 6 * 60 * 60 * 1000);
  const midnight = Date.UTC(nightDate.getUTCFullYear(), nightDate.getUTCMonth(), nightDate.getUTCDate());
  const day = 24 * 60 * 60 * 1000;
  if (filter === "tonight") return start < midnight + day + 6 * 60 * 60 * 1000 && end > midnight;
  const weekday = nightDate.getUTCDay();
  const friday = midnight + (weekday === 0 ? -2 : 5 - weekday) * day;
  return start >= friday && start < friday + 3 * day + 6 * 60 * 60 * 1000;
}
