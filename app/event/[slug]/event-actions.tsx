"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";

export default function EventActions({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
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
