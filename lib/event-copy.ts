/** Editorial copy belongs to an event, never to its music category or perks. */
export function normalizeEventTagline(value: unknown, required = false): string | null {
  const tagline = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (!tagline && !required) return null;
  if (tagline.length < 6 || tagline.length > 100) throw new Error("Write an original event line between 6 and 100 characters.");
  return tagline;
}

export async function assertOriginalEventTagline(db: D1Database, tagline: string | null, slug: string) {
  if (!tagline) return;
  const duplicate = await db.prepare("SELECT slug FROM curated_event_records WHERE lower(trim(tagline)) = lower(?) AND slug <> ? LIMIT 1").bind(tagline, slug).first();
  if (duplicate) throw new Error("That line already belongs to another event. Give this one its own words.");
}
