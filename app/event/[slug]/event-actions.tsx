"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import { trackProductMetric } from "../../../lib/client-analytics";

export default function EventActions({ title, eventSlug }: { title: string; eventSlug: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    trackProductMetric("share_started", eventSlug);
    const data = { title: `${title} · BeCore Tickets`, text: `See ${title} on BeCore Tickets.`, url: window.location.href };
    if (navigator.share) {
      await navigator.share(data).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return <button type="button" className="icon-text" onClick={share}><Share2 size={17} /> {copied ? "Link copied" : "Share"}</button>;
}
