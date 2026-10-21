"use client";

import { useLayoutEffect, useId, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import RoomOverlay from "../room-overlay";
import { useTopPanelPosition } from "../use-top-panel-position";

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
  const id = useId();
  const position = useTopPanelPosition(true, anchor, onClose);
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent("becore:header-panel", { detail: id }));
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) onClose(); };
    window.addEventListener("becore:header-panel", other);
    return () => window.removeEventListener("becore:header-panel", other);
  }, [id, onClose]);
  return createPortal(<RoomOverlay className="room-overlay--notifications" label={label} onClose={onClose} returnFocus={anchor}>{(dismiss) => <section className="notification-panel notification-panel--dropdown" onKeyDown={keepFocus} style={position}>{children(dismiss)}</section>}</RoomOverlay>, document.body);
}
