import RoomClient from "./room-client";
import { notFound } from "next/navigation";
import { findCuratedEvent } from "../../events";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const event = await findCuratedEvent(slug);
  if (!event) notFound();
  return <RoomClient slug={slug} fallbackTitle={event.title} fallbackDate={`${event.fullDate} · ${event.time}`} initialMode={query.view === "flashes" ? "flashes" : "chat"} />;
}
