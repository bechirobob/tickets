'use client';
import { useLayerHistory } from '@/app/use-layer-history';
import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal wrapper: details keep their existing server contracts and actions. */
export function RecordDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useLayerHistory(true, onClose);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const url = window.location.href;
    const navigated = () => { if (window.location.href !== url) dialog.current?.close(); };
    window.addEventListener('popstate', navigated);
    return () => { window.removeEventListener('popstate', navigated); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="workspace-record-dialog" aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>{children}</dialog>;
}
