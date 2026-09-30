"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
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
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let baseline = window.innerHeight;
    const update = () => {
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      const editing = document.activeElement instanceof HTMLElement && document.activeElement.matches("input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]");
      if (!editing) baseline = Math.max(window.innerHeight, height);
      const keyboard = Math.max(0, (editing ? Math.max(baseline, window.innerHeight) : window.innerHeight) - height - offset);
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-keyboard-inset", `${keyboard}px`);
      root.dataset.keyboard = keyboard > 120 ? "open" : "closed";
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update); document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
      root.style.removeProperty("--app-viewport-height"); root.style.removeProperty("--app-keyboard-inset"); delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
