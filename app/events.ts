import type { TicketTier } from "../lib/ticket-tiers";

export type EventState = "on_sale" | "sold_out" | "cancelled" | "postponed" | "rescheduled";

export type CuratedEvent = {
  slug: string;
  title: string;
  shortDate: string;
  fullDate: string;
  day: string;
  time: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  venueMapUrl: string | null;
  area: string;
  vibe: "Late night" | "Day party" | "Alté" | "Amapiano";
  price: number;
  priceFromMinor: number;
  bookingFeeBasisPoints: number;
  capacity: number;
  ageRestriction: string;
  lineup: string;
  eventState: EventState;
  isTestEvent: boolean;
  rescheduledFrom: string | null;
  salesOpenAt: string | null;
  salesCloseAt: string | null;
  ticketTiers: TicketTier[];
  image: string;
  note: string;
  quip: string;
  sequence: string;
};

type EventRecord = {
  slug: string;
  title: string;
  venue: string;
  venueMapUrl: string | null;
  area: string;
  startsAt: string;
  endsAt: string;
  vibe: CuratedEvent["vibe"];
  priceFromMinor: number;
  bookingFeeBasisPoints: number;
  capacity: number;
  salesOpenAt: string | null;
  salesCloseAt: string | null;
  ageRestriction: string;
  lineup: string;
  eventState: EventState;
  isTestEvent: number;
  rescheduledFrom: string | null;
  imageUrl: string;
  curationNote: string;
};

type TierRecord = {
  recordId: string;
  eventSlug: string;
  code: string;
  name: string;
  description: string;
  priceMinor: number;
  admissionsPerUnit: number;
  capacityAdmissions: number;
  maxUnitsPerOrder: number;
  configuredStatus: "available" | "sold_out" | "hidden";
  salesOpenAt: string | null;
  salesCloseAt: string | null;
  roomBadge: "VIP" | null;
  reservedAdmissions: number;
};

function formatEvent(record: EventRecord, tiers: TicketTier[], index: number): CuratedEvent {
  const starts = new Date(record.startsAt);
  const ends = new Date(record.endsAt);
  return {
    slug: record.slug,
    title: record.title,
    shortDate: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Accra" }).format(starts).toUpperCase(),
    fullDate: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" }).format(starts),
    day: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Africa/Accra" }).format(starts),
    time: `${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Accra" }).format(starts)} — ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Accra" }).format(ends)}`,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    venue: record.venue,
    venueMapUrl: record.venueMapUrl,
    area: record.area,
    vibe: record.vibe,
    price: record.priceFromMinor / 100,
    priceFromMinor: record.priceFromMinor,
    bookingFeeBasisPoints: record.bookingFeeBasisPoints,
    capacity: record.capacity,
    ageRestriction: record.ageRestriction,
    lineup: record.lineup,
    eventState: record.eventState,
    isTestEvent: Boolean(record.isTestEvent),
    rescheduledFrom: record.rescheduledFrom,
    salesOpenAt: record.salesOpenAt,
    salesCloseAt: record.salesCloseAt,
    ticketTiers: tiers,
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

function resolveTierStatus(record: EventRecord, tier: TierRecord, now: string): TicketTier["status"] {
  if (tier.configuredStatus === "hidden") return "hidden";
  if (record.eventState === "cancelled" || record.eventState === "postponed") return "closed";
  if (record.eventState === "sold_out" || tier.configuredStatus === "sold_out") return "sold_out";
  const opensAt = tier.salesOpenAt ?? record.salesOpenAt;
  const closesAt = tier.salesCloseAt ?? record.salesCloseAt;
  if (opensAt && opensAt > now) return "upcoming";
  if ((closesAt && closesAt <= now) || record.startsAt <= now) return "closed";
  if (tier.reservedAdmissions >= tier.capacityAdmissions) return "sold_out";
  return "available";
}

async function runtimeDb(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

async function loadPublicEventRecords(slug?: string): Promise<EventRecord[]> {
  const db = await runtimeDb();
  const now = new Date().toISOString();
  const slugFilter = slug ? "AND slug = ?" : "";
  const statement = db.prepare(`
    SELECT slug, title, venue, venue_map_url AS venueMapUrl, area,
           starts_at AS startsAt, ends_at AS endsAt, vibe,
           price_from_minor AS priceFromMinor, capacity,
           sales_open_at AS salesOpenAt, sales_close_at AS salesCloseAt,
           age_restriction AS ageRestriction, lineup,
           event_state AS eventState, is_test_event AS isTestEvent,
           rescheduled_from AS rescheduledFrom,
           image_url AS imageUrl, curation_note AS curationNote,
           COALESCE(
             (SELECT percentage_basis_points FROM booking_fee_rules
              WHERE scope = 'event' AND scope_id = curated_event_records.slug AND effective_at <= ?
              ORDER BY effective_at DESC LIMIT 1),
             (SELECT percentage_basis_points FROM booking_fee_rules
              WHERE scope = 'global' AND effective_at <= ?
              ORDER BY effective_at DESC LIMIT 1), 750
           ) AS bookingFeeBasisPoints
    FROM curated_event_records
    WHERE (status = 'published' OR (status = 'scheduled' AND scheduled_publish_at <= ?))
      ${slugFilter}
    ORDER BY starts_at, title
    LIMIT 100
  `);
  const result = slug
    ? await statement.bind(now, now, now, slug).all<EventRecord>()
    : await statement.bind(now, now, now).all<EventRecord>();
  return result.results;
}

async function loadTiers(eventSlugs: string[], now: string): Promise<TierRecord[]> {
  if (!eventSlugs.length) return [];
  const db = await runtimeDb();
  const placeholders = eventSlugs.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT tier.id AS recordId, tier.event_slug AS eventSlug, tier.code,
           tier.name, tier.description, tier.price_minor AS priceMinor,
           tier.admissions_per_unit AS admissionsPerUnit,
           tier.capacity_admissions AS capacityAdmissions,
           tier.max_units_per_order AS maxUnitsPerOrder,
           tier.status AS configuredStatus,
           tier.sales_open_at AS salesOpenAt, tier.sales_close_at AS salesCloseAt,
           tier.room_badge AS roomBadge,
           COALESCE(SUM(CASE
             WHEN reservation.status = 'consumed' THEN reservation.admission_count
             WHEN reservation.status = 'held' AND reservation.expires_at > ? THEN reservation.admission_count
             ELSE 0 END), 0) AS reservedAdmissions
    FROM event_ticket_tiers tier
    LEFT JOIN inventory_reservations reservation ON reservation.ticket_tier_id = tier.id
    WHERE tier.event_slug IN (${placeholders})
    GROUP BY tier.id
    ORDER BY tier.event_slug, tier.sort_order, tier.name
  `).bind(now, ...eventSlugs).all<TierRecord>();
  return result.results;
}

export async function getPublicEvents(): Promise<CuratedEvent[]> {
  try {
    const now = new Date().toISOString();
    const records = await loadPublicEventRecords();
    const tiers = await loadTiers(records.map((record) => record.slug), now);
    return records.map((record, index) => formatEvent(
      record,
      tiers.filter((tier) => tier.eventSlug === record.slug).map((tier) => ({
        id: tier.code,
        recordId: tier.recordId,
        name: tier.name,
        description: tier.description,
        priceMinor: tier.priceMinor,
        admissionsPerUnit: tier.admissionsPerUnit,
        maxUnitsPerOrder: tier.maxUnitsPerOrder,
        capacityAdmissions: tier.capacityAdmissions,
        remainingAdmissions: Math.max(0, tier.capacityAdmissions - tier.reservedAdmissions),
        status: resolveTierStatus(record, tier, now),
        roomBadge: tier.roomBadge === "VIP" ? "VIP" : null,
      })),
      index,
    ));
  } catch (error) {
    console.error(JSON.stringify({ message: "public event inventory unavailable", error: error instanceof Error ? error.message : String(error) }));
    return [];
  }
}

export async function findCuratedEvent(slug: string): Promise<CuratedEvent | null> {
  if (!/^[a-z0-9-]{1,80}$/u.test(slug)) return null;
  try {
    const now = new Date().toISOString();
    const records = await loadPublicEventRecords(slug);
    const record = records[0];
    if (!record) return null;
    const tiers = await loadTiers([record.slug], now);
    return formatEvent(record, tiers.map((tier) => ({
      id: tier.code,
      recordId: tier.recordId,
      name: tier.name,
      description: tier.description,
      priceMinor: tier.priceMinor,
      admissionsPerUnit: tier.admissionsPerUnit,
      maxUnitsPerOrder: tier.maxUnitsPerOrder,
      capacityAdmissions: tier.capacityAdmissions,
      remainingAdmissions: Math.max(0, tier.capacityAdmissions - tier.reservedAdmissions),
      status: resolveTierStatus(record, tier, now),
      roomBadge: tier.roomBadge === "VIP" ? "VIP" : null,
    })), 0);
  } catch (error) {
    console.error(JSON.stringify({ message: "event lookup unavailable", slug, error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}
