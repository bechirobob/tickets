"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLayerHistory } from "./use-layer-history";

const subscribeToReadiness = () => () => {};
const clientIsReady = () => true;
const serverIsReady = () => false;

/** One non-modal header disclosure at a time, with a reversible exit. */
export function useHeaderPanel() {
  const ready = useSyncExternalStore(subscribeToReadiness, clientIsReady, serverIsReady);
  const id = useId();
  const pathname = usePathname();
  const router = useRouter();
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
  const releaseHistory = useLayerHistory(phase === "open", () => close(true));
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
    let focusFrame: number | undefined;
    if (keyboardOpen.current) {
      keyboardOpen.current = false;
      // Wait for WebKit to apply the disclosure's inert/visibility change and
      // finish the trigger's native keyboard activation before moving focus.
      focusFrame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true }));
    }
    const contains = (target: EventTarget | null) => target instanceof Node && (panel.current?.contains(target) || trigger.current?.contains(target));
    let pointerDestination: Element | null = null;
    const pointer = (event: PointerEvent) => {
      // A destination click consumes the layer before routing in the click
      // handler below. Closing on pointerdown would race that navigation.
      pointerDestination = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (pointerDestination) return;
      if (!contains(event.target)) close();
    };
    const focus = (event: FocusEvent) => { if (!contains(event.target) && event.target !== pointerDestination) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const navigate = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.download || link.origin !== window.location.origin || !window.matchMedia("(max-width: 760px)").matches) return;
      event.preventDefault();
      const href = link.pathname + link.search + link.hash;
      const finished = releaseHistory();
      close();
      void finished.then(() => router.push(href));
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", key);
    window.addEventListener("becore:header-panel", other);
    document.addEventListener("click", navigate, true);
    return () => {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", key);
      window.removeEventListener("becore:header-panel", other);
      document.removeEventListener("click", navigate, true);
    };
  }, [close, id, phase, releaseHistory, router]);
  return { id, trigger, panel, ready, phase, open: phase === "open", mounted: phase !== "closed", toggle, close };
}
