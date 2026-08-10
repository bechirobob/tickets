import RoomClient from "./room-client";
import { getCuratedEvent } from "../../events";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getCuratedEvent(slug);
  return <RoomClient slug={slug} fallbackTitle={event.title} fallbackDate={`${event.fullDate} · ${event.time}`} />;
}
