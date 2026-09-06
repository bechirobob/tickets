"use client";

import Image from "next/image";

import { ArrowUp, Camera, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import RoomOverlay from "../../room-overlay";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";
import type { RoomFlash } from "./flashes-panel";

type PreparedPhoto = { file: File; previewUrl: string };

export default function FlashCamera({ slug, onClose, onSent }: { slug: string; onClose: () => void; onSent: (flash: RoomFlash) => void }) {
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const stopCamera = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => {
    if (prepared) return;
    const current = ++generation.current;
    let cancelled = false;
    async function start() {
      setReady(false); setError("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera. Try your phone’s browser.");
        const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1920 } } });
        if (cancelled || current !== generation.current) { next.getTracks().forEach((track) => track.stop()); return; }
        stream.current = next;
        if (video.current) { video.current.srcObject = next; await video.current.play(); }
        if (!cancelled && current === generation.current) setReady(true);
      } catch (cause) {
        if (!cancelled && current === generation.current) {
          stopCamera();
          setError(cause instanceof Error && cause.name === "NotAllowedError" ? "Camera permission is off. Allow it in your browser settings, then try again." : "The camera couldn’t start. Check it isn’t being used elsewhere and try again.");
        }
      }
    }
    void start();
    return () => { cancelled = true; stopCamera(); };
  }, [facing, attempt, prepared, stopCamera]);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl); }, [prepared]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") { stopCamera(); setReady(false); } else if (!prepared) setAttempt((value) => value + 1); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [prepared, stopCamera]);

  async function capturePhoto() {
    const element = video.current;
    if (!ready || pending.current || !element?.videoWidth || !element.videoHeight) return;
    pending.current = true;
    const current = generation.current;
    const scale = Math.min(1, 1600 / Math.max(element.videoWidth, element.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
    const context = canvas.getContext("2d");
    try {
      if (!context) throw new Error("The camera missed that one. Try again.");
      if (facing === "user") { context.translate(canvas.width, 0); context.scale(-1, 1); }
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .88));
      if (current !== generation.current) return;
      if (!blob) throw new Error("The camera missed that one. Try again.");
      stopCamera(); setConsent(false); setError("");
      setPrepared({ file: new File([blob], "flash.jpg", { type: "image/jpeg" }), previewUrl: URL.createObjectURL(blob) });
    } catch (cause) { if (current === generation.current) setError(requestErrorMessage(cause)); }
    finally { pending.current = false; }
  }

  async function upload() {
    if (!prepared || !consent || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const body = new FormData(); body.set("photo", prepared.file); body.set("consent", "yes");
    try {
      const result = await requestJson<{ flash: RoomFlash }>(`/api/rooms/${encodeURIComponent(slug)}/flashes`, { method: "POST", body }, 45_000);
      if (!result.flash?.id) throw new Error("We couldn’t confirm the send. Check Flashes before trying again.");
      onSent(result.flash); onClose();
    } catch (cause) { setError(requestErrorMessage(cause)); }
    finally { pending.current = false; setBusy(false); }
  }

  return <RoomOverlay label={prepared ? "Share this Flash" : "Flash camera"} className="room-overlay--immersive" onClose={onClose} beforeClose={stopCamera} busy={busy}>{(dismiss) => <section className="flash-stage flash-capture">
    {prepared ? <Image fill unoptimized sizes="100vw" className="flash-stage__image" src={prepared.previewUrl} alt="Your Flash before sharing" draggable={false} /> : <video ref={video} className={`flash-stage__image${facing === "user" ? " is-mirrored" : ""}`} autoPlay playsInline muted aria-label="Live camera preview" />}
    <header className="flash-stage__header"><span><b>{prepared ? "Worth a Flash?" : "Catch the moment."}</b><small>{prepared ? "One look for everyone else." : "No camera roll. Just right now."}</small></span><button type="button" aria-label="Close camera" disabled={busy} onClick={dismiss}><X aria-hidden="true" size={22} /></button></header>
    {!prepared && !ready && !error && <p className="flash-stage__waiting" role="status"><Camera aria-hidden="true" size={28} />Opening your camera…</p>}
    <footer className="flash-stage__footer">
      {error && <p className="room-surface-error" role="alert">{error}</p>}
      {prepared ? <><label className="flash-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>Everyone pictured is happy to be in this Room.</span></label><div className="flash-capture__actions"><button type="button" disabled={busy} onClick={() => { setPrepared(null); setConsent(false); setError(""); }}>Retake</button><button type="button" className="room-surface-send" disabled={busy || !consent} onClick={() => void upload()}>{busy ? "Sending…" : "Send Flash"}<ArrowUp aria-hidden="true" size={19} /></button></div></> : <div className="flash-capture__actions"><span />{error ? <button type="button" className="room-surface-send" onClick={() => setAttempt((value) => value + 1)}>Try camera again</button> : <button className="flash-shutter" type="button" disabled={!ready} aria-label="Take Flash photo" onClick={() => void capturePhoto()}><span /></button>}<button type="button" aria-label="Switch camera" onClick={() => setFacing((value) => value === "user" ? "environment" : "user")}><RefreshCw aria-hidden="true" size={22} /></button></div>}
      <small className="flash-fine-print">Ten seconds to view. Screenshots are still possible.</small>
    </footer>
  </section>}</RoomOverlay>;
}
