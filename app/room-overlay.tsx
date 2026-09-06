"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** A Room surface keeps native focus containment, including while it exits. */
export default function RoomOverlay({ label, onClose, children, className = "", beforeClose, busy = false }: {
  label: string; onClose: () => void; children: (dismiss: () => void) => ReactNode;
  className?: string; beforeClose?: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const callbacks = useRef({ onClose, beforeClose, busy });
  const [closing, setClosing] = useState(false);
  useEffect(() => { callbacks.current = { onClose, beforeClose, busy }; }, [onClose, beforeClose, busy]);
  const dismiss = useCallback(() => {
    if (closingRef.current || callbacks.current.busy) return;
    closingRef.current = true;
    callbacks.current.beforeClose?.();
    setClosing(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) callbacks.current.onClose();
    else timer.current = setTimeout(() => callbacks.current.onClose(), 160);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.close();
      queueMicrotask(() => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !document.querySelector("dialog[open]")) previousFocus.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialog} className={`room-overlay ${className}`} aria-label={label} data-phase={closing ? "closing" : "open"}
    onCancel={(event) => { event.preventDefault(); dismiss(); }} onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    {/* This render prop passes dismiss to event handlers; it never invokes it while rendering. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    {children(dismiss)}
  </dialog>;
}
