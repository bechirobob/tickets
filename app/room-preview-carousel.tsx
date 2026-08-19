"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode, UIEvent } from "react";
import { useRef, useState } from "react";

export default function RoomPreviewCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const show = (index: number) => {
    const track = trackRef.current;
    const slides = track?.querySelectorAll<HTMLElement>(".room-product-phone");
    const slide = slides?.[index];
    if (!track || !slide) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: reduceMotion ? "auto" : "smooth" });
    setActive(index);
  };

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
    <div ref={trackRef} className="room-product-scene__phones" onScroll={trackPosition} aria-live="polite" tabIndex={0}>
      {children}
    </div>
    <div className="room-product-preview__controls">
      <p><b>{active + 1} of 2</b><span>Swipe to see both sides of the night</span></p>
      <div>
        <button type="button" aria-label="Show previous Room preview" disabled={active === 0} onClick={() => show(active - 1)}><ArrowLeft size={17} /></button>
        <button type="button" aria-label="Show next Room preview" disabled={active === 1} onClick={() => show(active + 1)}><ArrowRight size={17} /></button>
      </div>
    </div>
  </div>;
}
