"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function TicketDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="ticket-transfer-modal" aria-label={label} onCancel={onClose} onClose={onClose}>{children}</dialog>;
}
