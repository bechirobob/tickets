"use client";

import { useCallback, useEffect, useRef } from "react";

const field = "becoreLayer";
let releaseInFlight: Promise<void> = Promise.resolve();

/** Same-URL history entry lets mobile Back dismiss the top layer first. */
export function useLayerHistory(open: boolean, onBack: () => void, busy = false) {
  const state = useRef<{ id: string; url: string; owned: boolean } | null>(null);
  const callbacks = useRef({ onBack, busy });
  useEffect(() => { callbacks.current = { onBack, busy }; }, [onBack, busy]);
  const release = useCallback(() => {
    const entry = state.current;
    if (!entry?.owned) return Promise.resolve();
    entry.owned = false;
    if (window.location.href !== entry.url || window.history.state?.[field] !== entry.id) return Promise.resolve();
    const pending = new Promise<void>(resolve => {
      function finish() { clearTimeout(timer); window.removeEventListener("popstate", finish); resolve(); }
      window.addEventListener("popstate", finish, { once: true });
      const timer = setTimeout(finish, 1000);
      window.history.back();
    });
    releaseInFlight = pending;
    return pending;
  }, []);
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 760px)").matches) return;
    const entry = { id: crypto.randomUUID(), url: window.location.href, owned: false };
    state.current = entry;
    let cancelled = false;
    // React cleans up old layers before mounting replacements. Wait for their
    // asynchronous Back before adding the new entry, including rapid toggles.
    void releaseInFlight.then(() => {
      if (cancelled || window.location.href !== entry.url) return;
      const previous = window.history.state ?? {};
      window.history.pushState({ ...previous, [field]: entry.id }, "", entry.url);
      entry.owned = true;
    });
    const pop = () => {
      if (!entry.owned || window.history.state?.[field] === entry.id) return;
      if (callbacks.current.busy && window.location.href === entry.url) {
        window.history.pushState({ ...window.history.state, [field]: entry.id }, "", entry.url);
        return;
      }
      entry.owned = false;
      callbacks.current.onBack();
    };
    window.addEventListener("popstate", pop);
    return () => { cancelled = true; window.removeEventListener("popstate", pop); void release(); };
  }, [open, release]);
  return release;
}
