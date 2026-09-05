"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function TicketDialog({ label, onClose, children, className = "ticket-transfer-modal" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      // React removes the dialog after effect cleanup. Restore focus afterwards
      // so Chromium does not reset the native restoration to the document body.
      queueMicrotask(() => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !document.querySelector("dialog[open]")) {
          previousFocus.focus({ preventScroll: true });
        }
      });
    };
  }, []);
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={onClose} onClose={onClose}>{children}</dialog>;
}
