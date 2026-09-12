import type { CuratedEvent } from "./customer-screen";

export type EventWindow = "tonight" | "tomorrow" | "weekend" | "next" | "date";

export function matchesEventWindow(event: Pick<CuratedEvent, "startsAt" | "endsAt" | "eventState">, filter: EventWindow, now: number, selectedDate = "") {
  if (event.eventState === "cancelled" || event.eventState === "postponed") return false;
  if (!event.startsAt) return filter === "next";
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : Math.floor(start / 86400000) * 86400000 + 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return false;
  if (filter === "next") return true;
  const day = 24 * 60 * 60 * 1000;
  // Explicit dates and Tomorrow use Accra's calendar day, independent of the
  // viewer's timezone. Tonight retains its separate after-midnight convention.
  if (filter === "date" || filter === "tomorrow") {
    const dateStart = filter === "tomorrow"
      ? Math.floor(now / day) * day + day
      : /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? Date.parse(`${selectedDate}T00:00:00Z`) : NaN;
    if (!Number.isFinite(dateStart) || (filter === "date" && new Date(dateStart).toISOString().slice(0, 10) !== selectedDate)) return false;
    return start >= dateStart && start < dateStart + day;
  }
  // Accra uses UTC. A night rolls over at 06:00, retaining after-midnight sets.
  const nightDate = new Date(now - 6 * 60 * 60 * 1000);
  const midnight = Date.UTC(nightDate.getUTCFullYear(), nightDate.getUTCMonth(), nightDate.getUTCDate());
  if (filter === "tonight") return start < midnight + day + 6 * 60 * 60 * 1000 && end > midnight;
  const weekday = nightDate.getUTCDay();
  const friday = midnight + (weekday === 0 ? -2 : 5 - weekday) * day;
  return start >= friday && start < friday + 3 * day + 6 * 60 * 60 * 1000;
}
