import { notFound } from "next/navigation";
import { findCuratedEvent } from "../../events";
import NightHub from "./night-hub";

export const dynamic = "force-dynamic";

export default async function MyNightPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) notFound();
  return <NightHub event={{
    slug: event.slug,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    fullDate: event.fullDate,
    time: event.time,
    venue: event.venue,
    area: event.area,
    image: event.image,
    venueMapUrl: event.venueMapUrl,
    lineup: event.lineup,
    ageRestriction: event.ageRestriction,
    eventState: event.eventState,
  }} />;
}
