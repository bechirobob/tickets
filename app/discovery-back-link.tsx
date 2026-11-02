"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { restorePublicDestination } from "./public-browsing-memory";

export default function DiscoveryBackLink() {
  return <Link href="/events" scroll={false} className="back-link" aria-label="The Drop" onClick={event => {
    if (!event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) restorePublicDestination("/events");
  }}><ArrowLeft size={17} aria-hidden="true" /><span className="back-link__label">The Drop</span></Link>;
}
