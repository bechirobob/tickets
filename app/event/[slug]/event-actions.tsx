"use client";

import { Link2, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { useCustomerRuntime } from "../../customer-runtime";
import { trackProductMetric } from "../../../lib/client-analytics";

export default function EventActions({ title, eventSlug }: { title: string; eventSlug: string }) {
  const runtime = useCustomerRuntime();
  const [outcome, setOutcome] = useState<"copied" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const inFlight = useRef(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const [lastAction, setLastAction] = useState<"copy" | "share">("share");

  function closeFeedback() {
    setOutcome(null);
    (lastAction === "copy" ? copyButton : shareButton).current?.focus();
  }

  async function share(copyOnly = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLastAction(copyOnly ? "copy" : "share");
    setBusy(true);
    setOutcome(null);
    const url = `https://tickets.becoreops.com/event/${encodeURIComponent(eventSlug)}`;
    setShareUrl(url);
    try {
      if (!runtime.openSecurePage) trackProductMetric("share_started", eventSlug);
      const data = { title: `${title} · BeCore Tickets`, text: `${title}. Shall we?`, url };
      if (!copyOnly && (runtime.share || navigator.share)) {
        try {
          await (runtime.share ? runtime.share(data) : navigator.share(data));
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
    <button ref={copyButton} type="button" className="icon-text" onClick={() => void share(true)} disabled={busy} aria-busy={busy && lastAction === "copy"}><Link2 size={17} /> {busy && lastAction === "copy" ? "Copying…" : "Copy Link"}</button>
    <button ref={shareButton} type="button" className="icon-text" onClick={() => void share()} disabled={busy} aria-busy={busy} aria-expanded={outcome !== null} aria-controls={outcome ? "event-share-feedback" : undefined}><Share2 size={17} /> {busy ? "Opening…" : "Share"}</button>
    {outcome && <div id="event-share-feedback" className="event-share__feedback">
      <p role="status">{outcome === "copied" ? "Link copied. Send it to the usual suspects." : "The copy button’s sitting this one out. Select the link below to copy it."}</p>
      {outcome === "manual" && <label>Event link<input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} /></label>}
      <button type="button" onClick={closeFeedback}>Got it</button>
    </div>}
  </div>;
}
