"use client";

import type { ReactNode, UIEvent } from "react";
import { useRef, useState } from "react";

export default function RoomPreviewCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

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
    <div ref={trackRef} className="room-product-scene__phones" onScroll={trackPosition} aria-live="off" tabIndex={0}>
      {children}
    </div>
    <p className="sr-only" aria-live="polite">Room preview {active + 1} of 2. Swipe or use the arrow keys to see both views.</p>
  </div>;
}
