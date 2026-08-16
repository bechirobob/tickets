function escapeIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/gu, "\\n");
}

function utcStamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function eventCalendar(input: {
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  area: string;
  description?: string;
  origin: string;
}) {
  const url = `${input.origin}/events/${encodeURIComponent(input.slug)}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Becore Tickets//My Nights//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(input.slug)}@tickets.becoreops.com`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART:${utcStamp(input.startsAt)}`,
    `DTEND:${utcStamp(input.endsAt)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
    `LOCATION:${escapeIcs(`${input.venue}, ${input.area}`)}`,
    `DESCRIPTION:${escapeIcs(input.description ?? `Your night at ${input.title}. Open My Nights for your ticket and live Host updates.`)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
