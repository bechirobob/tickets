"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function TicketDialog({ label, onClose, children, className = "ticket-transfer-modal" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={onClose} onClose={onClose}>{children}</dialog>;
}
