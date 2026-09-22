import RoomClient from "./room-client";
import { notFound } from "next/navigation";
import { findPublicRoomEvent } from "../../events";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findPublicRoomEvent(slug);
  if (!event) notFound();
  return <RoomClient slug={slug} fallbackTitle={event.title} fallbackDate={`${event.fullDate} · ${event.time}`} eventImage={event.image} />;
}
