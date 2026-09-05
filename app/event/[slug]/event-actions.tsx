"use client";

import { Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { trackProductMetric } from "../../../lib/client-analytics";

export default function EventActions({ title, eventSlug }: { title: string; eventSlug: string }) {
  const [outcome, setOutcome] = useState<"copied" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const inFlight = useRef(false);
  const shareButton = useRef<HTMLButtonElement>(null);

  function closeFeedback() {
    setOutcome(null);
    shareButton.current?.focus();
  }

  async function share() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    const url = window.location.href;
    setShareUrl(url);
    try {
      trackProductMetric("share_started", eventSlug);
      const data = { title: `${title} · BeCore Tickets`, text: `${title}. Shall we?`, url };
      if (navigator.share) {
        try {
          await navigator.share(data);
          return;
        } catch (error) {
          // Closing the native sheet is a choice, not a failed share.
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setOutcome("copied");
      } catch {
        setOutcome("manual");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="event-share" onKeyDown={(event) => { if (event.key === "Escape" && outcome) { event.stopPropagation(); closeFeedback(); } }}>
    <button ref={shareButton} type="button" className="icon-text" onClick={() => void share()} disabled={busy} aria-busy={busy} aria-expanded={outcome !== null} aria-controls={outcome ? "event-share-feedback" : undefined}><Share2 size={17} /> {busy ? "Opening…" : "Share"}</button>
    {outcome && <div id="event-share-feedback" className="event-share__feedback">
      <p role="status">{outcome === "copied" ? "Link copied. Send it to the usual suspects." : "Your browser won’t copy this one. Select the link below and copy it yourself."}</p>
      {outcome === "manual" && <label>Event link<input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} /></label>}
      <button type="button" onClick={closeFeedback}>Got it</button>
    </div>}
  </div>;
}
