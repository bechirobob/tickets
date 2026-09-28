"use client";

import { useEffect, useRef, useState } from "react";
import "./cuppy-guest.css";

/** Approved artist treatment for On The Guest List, independent of its flyer. */
export default function CuppyGuest() {
  const guest = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = guest.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      element.dataset.playing = String(visible && !document.hidden && !preference.matches && !paused);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      element.dataset.playing = "false";
    };
  }, [paused]);

  return <div className="cuppy-guest" ref={guest} data-playing="false">
    <button type="button" className="cuppy-guest__toggle" onClick={() => setPaused(value => !value)} aria-label={paused ? "Play Cuppy animation" : "Pause Cuppy animation"} title={paused ? "Play animation" : "Tap to pause"}>
      <span className="cuppy-guest__art" aria-hidden="true" />
      <span className="cuppy-guest__name"><small>Special Guest DJ</small><strong>Cuppy</strong></span>
    </button>
  </div>;
}
