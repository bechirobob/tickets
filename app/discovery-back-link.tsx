"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { restorePublicDestination } from "./public-browsing-memory";

export default function DiscoveryBackLink() {
  return <Link href="/events" scroll={false} className="back-link" onClick={event => {
    if (!event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) restorePublicDestination("/events");
  }}><ArrowLeft size={17} /> The Drop</Link>;
}
