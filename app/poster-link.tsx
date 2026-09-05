"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentProps, type PointerEvent } from "react";

/** A small change in viewing angle gives the artwork a printed, laminated surface. */
export default function PosterLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  const link = useRef<HTMLAnchorElement>(null);
  const frame = useRef<number | null>(null);

  function reset() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    link.current?.style.removeProperty("--poster-x");
    link.current?.style.removeProperty("--poster-y");
    link.current?.style.removeProperty("--poster-light");
  }

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", reset);
    return () => { motion.removeEventListener("change", reset); reset(); };
  }, []);

  function followPointer(event: PointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      link.current?.style.setProperty("--poster-x", `${(0.5 - y) * 2.6}deg`);
      link.current?.style.setProperty("--poster-y", `${(x - 0.5) * 2.6}deg`);
      link.current?.style.setProperty("--poster-light", `${20 + x * 60}%`);
      frame.current = null;
    });
  }

  return <Link {...props} ref={link} className={`${className ?? ""} poster-link`} onPointerMove={followPointer} onPointerLeave={reset} onPointerCancel={reset} onBlur={reset}>{children}</Link>;
}
