"use client";

import { useLayoutEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import RoomOverlay from "../room-overlay";

function keepFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter((element) => {
    const closed = element.closest("details:not([open])");
    return element.getClientRects().length > 0 && (!closed || closed.querySelector("summary")?.contains(element));
  });
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export default function NotificationPanel({ anchor, label, onClose, children }: { anchor: RefObject<HTMLButtonElement | null>; label: string; onClose: () => void; children: (dismiss: () => void) => ReactNode }) {
  const [position, setPosition] = useState({ top: 70, right: 16 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setPosition({ top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 240)), right: Math.max(12, Math.min(window.innerWidth - rect.right, window.innerWidth - Math.min(410, window.innerWidth - 24) - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  return createPortal(<RoomOverlay className="room-overlay--notifications" label={label} onClose={onClose} returnFocus={anchor}>{(dismiss) => <section className="notification-panel" onKeyDown={keepFocus} style={{ "--notification-top": `${position.top}px`, "--notification-right": `${position.right}px` } as CSSProperties}>{children(dismiss)}</section>}</RoomOverlay>, document.body);
}
