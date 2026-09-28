"use client";

import { useEffect, useRef, useState } from "react";
import "./cuppy-guest.css";

/** Approved artist treatment for On The Guest List, independent of its flyer. */
export default function CuppyGuest() {
  const guest = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"auto" | "playing" | "paused">("auto");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = guest.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      setPlaying(visible && !document.hidden && mode !== "paused" && (mode === "playing" || !preference.matches));
    };
    const onPreferenceChange = () => {
      setMode("auto");
      if (mode === "auto") update();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("visibilitychange", update);
    };
  }, [mode]);

  return <div className="cuppy-guest" ref={guest} data-playing={playing}>
    <button type="button" className="cuppy-guest__toggle" onClick={() => setMode(playing ? "paused" : "playing")} aria-label={playing ? "Pause Cuppy animation" : "Play Cuppy animation"} aria-description="Special Guest DJ Cuppy" title={playing ? "Tap to pause" : "Tap to play"}>
      <span className="cuppy-guest__art" aria-hidden="true" />
      <span className="cuppy-guest__name"><small>Special Guest DJ</small><strong>Cuppy</strong></span>
    </button>
  </div>;
}
