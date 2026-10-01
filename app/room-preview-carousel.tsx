"use client";

import type { ReactNode, UIEvent } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const Playback = createContext({ paused: false, reducedMotion: true });
export const useRoomPlayback = () => useContext(Playback);

export default function RoomPreviewCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const trackPosition = (event: UIEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    const slides = [...track.querySelectorAll<HTMLElement>(".room-product-phone")];
    if (!slides.length) return;
    const nearest = slides.reduce((best, slide, index) => {
      const distance = Math.abs(slide.offsetLeft - track.offsetLeft - track.scrollLeft);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Number.POSITIVE_INFINITY });
    setActive(nearest.index);
  };

  return <div className="room-product-preview" data-active={active} role="region" aria-roledescription="carousel" aria-label="The Room preview">
    <Playback value={{ paused, reducedMotion }}>
    <div ref={trackRef} className="room-product-scene__phones" tabIndex={0} onScroll={trackPosition} onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)} aria-live="off">
      {children}
    </div>
    </Playback>
    <div className="room-demo-caption"><span>{active === 0 ? "Before arrival" : "Inside the night"}</span><button type="button" className="room-demo-pause" aria-label={paused ? "Play Room preview" : "Pause Room preview"} aria-pressed={paused} disabled={reducedMotion} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button></div>
    <p className="sr-only" aria-live="polite">Room preview {active + 1} of 2. Swipe or use the arrow keys to see both views.</p>
  </div>;
}
