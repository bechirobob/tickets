export type CuratedEvent = {
  slug: string;
  title: string;
  shortDate: string;
  fullDate: string;
  day: string;
  time: string;
  venue: string;
  area: string;
  vibe: "Late night" | "Day party" | "Alté" | "Amapiano";
  price: number;
  image: string;
  note: string;
  quip: string;
  sequence: string;
};

export const curatedEvents: CuratedEvent[] = [
  {
    slug: "after-dark-osu",
    title: "After Dark: Osu",
    shortDate: "14 AUG",
    fullDate: "Friday, 14 August 2026",
    day: "Friday",
    time: "10:00 PM — 4:00 AM",
    venue: "The Treehouse",
    area: "Osu",
    vibe: "Late night",
    price: 120,
    image: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88",
    note: "A compact room, a sharp DJ line-up and zero space for standing like you were forced to attend. Come early.",
    quip: "Small room. Big decisions.",
    sequence: "01",
  },
  {
    slug: "noir-room-labone",
    title: "The Noir Room",
    shortDate: "15 AUG",
    fullDate: "Saturday, 15 August 2026",
    day: "Saturday",
    time: "9:30 PM — 3:00 AM",
    venue: "The Glass House",
    area: "Labone",
    vibe: "Alté",
    price: 180,
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1500&q=88",
    note: "For a dressed-up crowd that wants discovery, not the same playlist on repeat. Your everyday black T-shirt needs a convincing argument.",
    quip: "Dress like your ex might be there.",
    sequence: "02",
  },
  {
    slug: "sun-chasers-labadi",
    title: "Sun Chasers",
    shortDate: "16 AUG",
    fullDate: "Sunday, 16 August 2026",
    day: "Sunday",
    time: "3:00 PM — 11:00 PM",
    venue: "The Cove",
    area: "Labadi",
    vibe: "Day party",
    price: 150,
    image: "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1500&q=88",
    note: "Sunset timing, open air and enough space to make a full Sunday of it. Sunglasses may become emotional support by 7 PM.",
    quip: "Sunset first. Regret nothing.",
    sequence: "03",
  },
  {
    slug: "longitude-spintex",
    title: "Longitude 05",
    shortDate: "21 AUG",
    fullDate: "Friday, 21 August 2026",
    day: "Next Friday",
    time: "11:00 PM — late",
    venue: "Untamed Empire",
    area: "Spintex",
    vibe: "Amapiano",
    price: 100,
    image: "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1500&q=88",
    note: "A focused dance floor with production that earns the warehouse. Sensible shoes were considered, then respectfully declined.",
    quip: "The shoes will not survive.",
    sequence: "04",
  },
];

function fromRecord(record: {
  slug: string; title: string; startsAt: string; endsAt: string; venue: string; area: string;
  vibe: "Late night" | "Day party" | "Alté" | "Amapiano"; priceFromMinor: number;
  imageUrl: string; curationNote: string;
}, index = 0): CuratedEvent {
  const starts = new Date(record.startsAt);
  const ends = new Date(record.endsAt);
  return {
    slug: record.slug,
    title: record.title,
    shortDate: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Accra" }).format(starts).toUpperCase(),
    fullDate: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" }).format(starts),
    day: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Africa/Accra" }).format(starts),
    time: `${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Accra" }).format(starts)} — ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Accra" }).format(ends)}`,
    venue: record.venue,
    area: record.area,
    vibe: record.vibe,
    price: record.priceFromMinor / 100,
    image: record.imageUrl,
    note: record.curationNote,
    quip: {
      "Late night": "Small room. Big decisions.",
      "Day party": "Sunset first. Regret nothing.",
      "Alté": "Dress like your ex might be there.",
      "Amapiano": "The shoes will not survive.",
    }[record.vibe],
    sequence: String(index + 1).padStart(2, "0"),
  };
}

export async function getPublicEvents(): Promise<CuratedEvent[]> {
  try {
    const [{ and, asc, eq, lte, or }, { getDb }, { curatedEventRecords }] = await Promise.all([
      import("drizzle-orm"), import("../db"), import("../db/schema"),
    ]);
    const db = await getDb();
    const now = new Date().toISOString();
    const records = await db.select().from(curatedEventRecords).where(or(
      eq(curatedEventRecords.status, "published"),
      and(eq(curatedEventRecords.status, "scheduled"), lte(curatedEventRecords.scheduledPublishAt, now)),
    )).orderBy(asc(curatedEventRecords.startsAt));
    if (records.length) return records.map(fromRecord);
  } catch {
    // The representative edit remains available during builds and before D1 is provisioned.
  }
  return curatedEvents;
}

export async function getCuratedEvent(slug: string) {
  const events = await getPublicEvents();
  return events.find((event) => event.slug === slug) ?? curatedEvents.find((event) => event.slug === slug) ?? curatedEvents[0];
}
