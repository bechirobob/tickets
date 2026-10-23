"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLayerHistory } from "./use-layer-history";

const subscribeToReadiness = () => () => {};
const clientIsReady = () => true;
const serverIsReady = () => false;

/** One non-modal header disclosure at a time, with a reversible exit. */
export function useHeaderPanel(exitDuration = 180) {
  const ready = useSyncExternalStore(subscribeToReadiness, clientIsReady, serverIsReady);
  const id = useId();
  const pathname = usePathname();
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrame = useRef<number | null>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const keyboardOpen = useRef(false);
  const navigationVersion = useRef(0);
  useEffect(() => () => { navigationVersion.current++; }, [pathname]);
  const close = useCallback((restore = false, immediately = false) => {
    if (timer.current) clearTimeout(timer.current);
    // A breakpoint close can precede the opening frame's passive cleanup.
    // Cancel it before restoring focus so it cannot enter the replacement panel.
    keyboardOpen.current = false;
    if (focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    }
    if (restore) trigger.current?.focus({ preventScroll: true });
    if (immediately || window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPhase("closed");
    else { setPhase("closing"); timer.current = setTimeout(() => setPhase("closed"), exitDuration); }
  }, [exitDuration]);
  const releaseHistory = useLayerHistory(phase === "open", () => close(true));
  const toggle = (keyboard = false) => {
    navigationVersion.current++;
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
    // Keep listening even after close: a replacement must neither overlap an
    // exiting panel nor allow its pending destination to hijack the new panel.
    const other = (event: Event) => {
      if ((event as CustomEvent).detail !== id) { navigationVersion.current++; close(false, true); }
    };
    window.addEventListener("becore:header-panel", other);
    return () => window.removeEventListener("becore:header-panel", other);
  }, [close, id]);
  useEffect(() => {
    if (phase !== "open") return;
    if (keyboardOpen.current) {
      keyboardOpen.current = false;
      const openingPanel = panel.current;
      // Wait for WebKit to apply the disclosure's inert/visibility change and
      // finish the trigger's native keyboard activation before moving focus.
      const frame = requestAnimationFrame(() => {
        if (focusFrame.current !== frame) return;
        focusFrame.current = null;
        if (panel.current === openingPanel) openingPanel?.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
      });
      focusFrame.current = frame;
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
    const navigate = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.download || link.origin !== window.location.origin || !window.matchMedia("(max-width: 760px)").matches) return;
      event.preventDefault();
      const href = link.pathname + link.search + link.hash;
      const previousUrl = window.location.href;
      const version = ++navigationVersion.current;
      const finished = releaseHistory();
      close();
      void finished.then(() => {
        if (navigationVersion.current === version && window.location.href === previousUrl) router.push(href);
      });
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", key);
    document.addEventListener("click", navigate, true);
    return () => {
      if (focusFrame.current !== null) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = null;
      }
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", navigate, true);
    };
  }, [close, id, phase, releaseHistory, router]);
  return { id, trigger, panel, ready, phase, open: phase === "open", mounted: phase !== "closed", toggle, close };
}
