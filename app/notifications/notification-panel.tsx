"use client";

import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import RoomOverlay from "../room-overlay";

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
  return createPortal(<RoomOverlay className="room-overlay--notifications" label={label} onClose={onClose}>{(dismiss) => <section className="notification-panel" style={{ "--notification-top": `${position.top}px`, "--notification-right": `${position.right}px` } as CSSProperties}>{children(dismiss)}</section>}</RoomOverlay>, document.body);
}
