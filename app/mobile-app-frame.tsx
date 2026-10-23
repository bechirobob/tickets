"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { mountMobileViewport } from "../lib/mobile-viewport";
import { rememberPublicScroll, takePublicScroll } from "./public-browsing-memory";

/** Geometry only: never requests device permissions or stores private form data. */
export default function MobileAppFrame() {
  const pathname = usePathname();
  useEffect(() => {
    const position = takePublicScroll(pathname);
    const frame = position === null ? null : requestAnimationFrame(() => window.scrollTo({ top: position, behavior: "instant" }));
    const scroll = () => rememberPublicScroll(pathname, window.scrollY);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.removeEventListener("scroll", scroll); if (frame !== null) cancelAnimationFrame(frame); };
  }, [pathname]);
  useEffect(mountMobileViewport, []);
  return null;
}
