"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

const subscribeToReadiness = () => () => {};
const clientIsReady = () => true;
const serverIsReady = () => false;

/** One non-modal header disclosure at a time, with a reversible exit. */
export function useHeaderPanel() {
  const ready = useSyncExternalStore(subscribeToReadiness, clientIsReady, serverIsReady);
  const id = useId();
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const keyboardOpen = useRef(false);
  const close = useCallback((restore = false) => {
    if (timer.current) clearTimeout(timer.current);
    if (restore) trigger.current?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPhase("closed");
    else { setPhase("closing"); timer.current = setTimeout(() => setPhase("closed"), 180); }
  }, []);
  const toggle = (keyboard = false) => {
    if (phase === "open") { close(true); return; }
    if (timer.current) clearTimeout(timer.current);
    keyboardOpen.current = keyboard;
    window.dispatchEvent(new CustomEvent("becore:header-panel", { detail: id }));
    setPhase("open");
  };
  const [currentPath, setCurrentPath] = useState(pathname);
  if (currentPath !== pathname) { setCurrentPath(pathname); setPhase("closed"); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (phase !== "open") return;
    if (keyboardOpen.current) {
      keyboardOpen.current = false;
      panel.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
    }
    const contains = (target: EventTarget | null) => target instanceof Node && (panel.current?.contains(target) || trigger.current?.contains(target));
    const pointer = (event: PointerEvent) => { if (!contains(event.target)) close(); };
    const focus = (event: FocusEvent) => { if (!contains(event.target)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", key);
    window.addEventListener("becore:header-panel", other);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", key);
      window.removeEventListener("becore:header-panel", other);
    };
  }, [close, id, phase]);
  return { id, trigger, panel, ready, phase, open: phase === "open", mounted: phase !== "closed", toggle, close };
}
