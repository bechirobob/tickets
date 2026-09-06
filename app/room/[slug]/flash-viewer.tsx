"use client";

import Image from "next/image";

import { Aperture, Flag, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import RoomOverlay from "../../room-overlay";
import { RequestError, requestErrorMessage, requestJson } from "../../../lib/client-request";
import { FLASH_VIEW_DURATION_MS } from "../../../lib/flashes";
import type { RoomFlash } from "./flashes-panel";

type Lease = { imageUrl: string; openedAt: string; remainingMs: number };

export default function FlashViewer({ slug, flash, onClose, onOpened, onReport, onRemove }: {
  slug: string; flash: RoomFlash; onClose: () => void; onOpened: (id: string, at: string) => void;
  onReport: () => void; onRemove: () => void;
}) {
  const nonce = useRef(crypto.randomUUID());
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const deadline = useRef<number | null>(null);
  const closed = useRef(false);
  const callbacks = useRef({ onClose, onOpened });
  const endpoint = `/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(flash.id)}`;
  useEffect(() => { callbacks.current = { onClose, onOpened }; }, [onClose, onOpened]);

  function clearImage() {
    controller.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null; setImage(null);
  }
  function endSession() {
    if (closed.current) return;
    closed.current = true; clearImage();
    void fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewId: nonce.current }), keepalive: true }).catch(() => undefined);
  }

  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    let cancelled = false;
    async function open() {
      setError("");
      try {
        const started = Date.now();
        const lease = await requestJson<Lease>(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewId: nonce.current }), signal: abort.signal }, 8_000);
        if (cancelled || closed.current) return;
        // Subtract the complete round trip: conservative across client clock skew.
        const until = Date.now() + lease.remainingMs - (Date.now() - started);
        deadline.current = deadline.current === null ? until : Math.min(deadline.current, until);
        callbacks.current.onOpened(flash.id, lease.openedAt);
        const response = await fetch(lease.imageUrl, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new RequestError("This Flash has left the Room.", response.status);
        const blob = await response.blob();
        if (cancelled || closed.current) return;
        if (Date.now() >= deadline.current) throw new RequestError("That moment has passed.", 410);
        objectUrl.current = URL.createObjectURL(blob); setImage(objectUrl.current);
        setRemaining(deadline.current - Date.now());
      } catch (cause) {
        if (cancelled || closed.current) return;
        if (cause instanceof RequestError && [401, 403, 404, 410].includes(cause.status ?? 0)) {
          setGone(true); callbacks.current.onOpened(flash.id, new Date().toISOString());
        }
        setError(requestErrorMessage(cause));
      }
    }
    void open();
    return () => { cancelled = true; abort.abort(); if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; } };
  }, [endpoint, flash.id, attempt]);

  useEffect(() => {
    const end = () => { endSession(); callbacks.current.onClose(); };
    const timer = window.setInterval(() => {
      if (deadline.current === null || closed.current) return;
      const left = deadline.current - Date.now();
      if (left <= 0) end(); else setRemaining(left);
    }, 100);
    const hidden = () => { if (document.visibilityState === "hidden") end(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", hidden); endSession(); };
    // The lease is scoped to this mounted viewer, never to a re-render or retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  return <RoomOverlay label={`Flash from ${flash.mine ? "you" : flash.displayName}`} className="room-overlay--immersive" onClose={onClose} beforeClose={endSession}>{(dismiss) => <section className="flash-stage flash-viewer">
    {image && <Image fill unoptimized sizes="100vw" className="flash-stage__image" src={image} alt={`Flash shared by ${flash.displayName}`} draggable={false} onContextMenu={(event) => event.preventDefault()} onError={() => { clearImage(); setError("That photo couldn’t be displayed."); setGone(true); }} />}
    <header className="flash-stage__header"><span><b>{flash.mine ? "Your Flash" : flash.displayName}</b><small>{flash.mine ? "Your own preview" : "One look. Make it count."}</small></span><button type="button" aria-label="Close Flash" onClick={dismiss}><X size={22} /></button></header>
    {image && <div className="flash-viewer__progress" role="progressbar" aria-label="Flash viewing time remaining" aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.ceil(remaining / 1000)}><i style={{ "--remaining": Math.max(0, remaining / FLASH_VIEW_DURATION_MS) } as CSSProperties} /></div>}
    {!image && <div className="flash-stage__waiting"><Aperture size={30} /><p role={error ? "alert" : "status"}>{error || "Opening your Flash…"}</p>{error && !gone && <button type="button" onClick={() => { setImage(null); setAttempt((value) => value + 1); }}>Try opening again</button>}</div>}
    <footer className="flash-stage__footer flash-viewer__footer"><small>{flash.mine ? "Only you can preview it again." : "Gone when you leave or the timer ends."}</small><button type="button" onClick={() => { endSession(); if (flash.mine) onRemove(); else onReport(); }} aria-label={flash.mine ? "Remove your Flash" : "Report this Flash"}>{flash.mine ? <Trash2 size={17} /> : <Flag size={17} />}{flash.mine ? "Remove" : "Report"}</button></footer>
  </section>}</RoomOverlay>;
}
