"use client";
import Link from "next/link";
import { restorePublicDestination } from "./public-browsing-memory";

export default function DiscoveryBackLink() {
  return <Link href="/events" scroll={false} className="back-link event-back-to-drop" onClick={event => {
    if (!event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) restorePublicDestination("/events");
  }}>Back to The Drop</Link>;
}
