"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLayerHistory } from "./use-layer-history";

/** A Room surface keeps native focus containment, including while it exits. */
export default function RoomOverlay({ label, onClose, children, className = "", beforeClose, busy = false, returnFocus }: {
  label: string; onClose: () => void; children: (dismiss: () => void) => ReactNode;
  className?: string; beforeClose?: () => void; busy?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const callbacks = useRef({ onClose, beforeClose, busy });
  const [closing, setClosing] = useState(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { callbacks.current = { onClose, beforeClose, busy }; }, [onClose, beforeClose, busy]);
  const dismiss = useCallback(() => {
    if (closingRef.current || callbacks.current.busy) return;
    closingRef.current = true;
    callbacks.current.beforeClose?.();
    setClosing(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) callbacks.current.onClose();
    else timer.current = setTimeout(() => callbacks.current.onClose(), 160);
  }, []);
  const releaseHistory = useLayerHistory(true, dismiss, busy);
  const closeLayer = () => { if (!busy) { releaseHistory(); dismiss(); } };
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = returnFocus?.current ?? document.activeElement;
    element?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.close();
      queueMicrotask(() => {
        if (document.querySelector("dialog[open]")) return;
        const target = previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.matches(":disabled") && previousFocus.getClientRects().length
          ? previousFocus : (document.querySelector<HTMLElement>(".room-flash-toggle:not(:disabled)") ?? document.querySelector<HTMLElement>(".room-header > a"));
        target?.focus({ preventScroll: true });
      });
    };
  }, [returnFocus]);
  return <dialog ref={dialog} className={`room-overlay ${className}`} aria-label={label} data-phase={closing ? "closing" : "open"}
    onCancel={(event) => { event.preventDefault(); closeLayer(); }} onClick={(event) => { if (event.target === event.currentTarget) closeLayer(); }}
    onPointerDown={event => {
      if (event.pointerType !== "touch" || busy || !className.includes("--sheet") || !(event.target instanceof Element) || !event.target.closest(".room-sheet__header") || event.target.closest("button,a,input,select,textarea")) return;
      gesture.current = { x: event.clientX, y: event.clientY };
    }}
    onPointerUp={event => {
      const start = gesture.current; gesture.current = null;
      if (start && event.clientY - start.y > 72 && Math.abs(event.clientX - start.x) < 48) closeLayer();
    }} onPointerCancel={() => { gesture.current = null; }}>
    {/* This render prop passes dismiss to event handlers; it never invokes it while rendering. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    {children(closeLayer)}
  </dialog>;
}
