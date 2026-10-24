"use client";

import Image from "next/image";

import { ArrowUp, Camera, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import RoomOverlay from "../../room-overlay";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";
import type { RoomFlash } from "./flashes-panel";
import FlashLookPicker from "./flash-look-picker";
import FlashLivePreview from "./flash-live-preview";
import { FLASH_LOOKS, flashCameraConstraints, flashCaptureFrame, renderFlashLook, type FlashLook } from "../../../lib/flash-photo-filters";

type CapturedPhoto = { canvas: HTMLCanvasElement; file: File; previewUrl: string };
type PreparedPhoto = { source: CapturedPhoto; look: FlashLook; strength: number; file: File; previewUrl: string };

export default function FlashCamera({ slug, onClose, onSent }: { slug: string; onClose: () => void; onSent: (flash: RoomFlash) => void }) {
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [look, setLook] = useState<FlashLook>("original");
  const [strength, setStrength] = useState(100);
  const [compare, setCompare] = useState(false);
  const [holding, setHolding] = useState(false);
  const [displayedUrl, setDisplayedUrl] = useState("");
  const [taking, setTaking] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const renderController = useRef<AbortController | null>(null);
  const original = look === "original" || strength === 0;
  const photo = captured && (original ? captured : prepared?.source === captured && prepared.look === look && prepared.strength === strength ? prepared : null);
  const comparing = compare || holding;
  const previewUrl = captured && (comparing ? captured.previewUrl : photo?.previewUrl ?? captured.previewUrl);
  const canSend = Boolean(photo && displayedUrl === photo.previewUrl && !comparing);
  const lookName = original ? "Original" : FLASH_LOOKS.find(option => option.id === look)?.name ?? "Original";
  const stopCamera = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => {
    if (captured) return;
    const current = ++generation.current;
    let cancelled = false;
    async function start() {
      setReady(false); setError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open a camera. Try your phone’s browser.");
        return;
      }
      try {
        const next = await navigator.mediaDevices.getUserMedia(flashCameraConstraints(facing));
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
  }, [facing, attempt, captured, stopCamera]);
  useEffect(() => () => {
    if (captured) { URL.revokeObjectURL(captured.previewUrl); captured.canvas.width = 0; captured.canvas.height = 0; }
  }, [captured]);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl); }, [prepared]);
  useEffect(() => {
    if (!captured || original) return;
    const controller = new AbortController();
    renderController.current = controller;
    const timer = setTimeout(() => {
      void renderFlashLook(captured.canvas, look, strength, controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        setPrepared({ source: captured, look, strength, file: new File([blob], "flash.jpg", { type: "image/jpeg" }), previewUrl: URL.createObjectURL(blob) });
      }).catch(cause => { if (!controller.signal.aborted) setError(requestErrorMessage(cause)); });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [captured, look, strength, original, renderAttempt]);
  useEffect(() => () => { renderController.current?.abort(); }, []);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") { stopCamera(); setReady(false); } else if (!captured) setAttempt((value) => value + 1); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [captured, stopCamera]);

  async function capturePhoto() {
    const element = video.current;
    if (!ready || (!original && !liveReady) || pending.current || !element?.videoWidth || !element.videoHeight) return;
    pending.current = true; setTaking(true);
    const current = generation.current;
    const canvas = document.createElement("canvas");
    let retained = false;
    try {
      const frame = flashCaptureFrame(element.videoWidth, element.videoHeight);
      canvas.width = frame.outputWidth; canvas.height = frame.outputHeight;
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context) throw new Error("The camera missed that one. Try again.");
      if (facing === "user") { context.translate(canvas.width, 0); context.scale(-1, 1); }
      context.drawImage(element, frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .88));
      if (current !== generation.current) return;
      if (!blob) throw new Error("The camera missed that one. Try again.");
      stopCamera(); setReady(false); setConsent(false); setError("");
      setCompare(false); setHolding(false); setDisplayedUrl("");
      retained = true;
      setCaptured({ canvas, file: new File([blob], "flash.jpg", { type: "image/jpeg" }), previewUrl: URL.createObjectURL(blob) });
    } catch (cause) { if (current === generation.current) setError(requestErrorMessage(cause)); }
    finally { pending.current = false; setTaking(false); if (!retained) { canvas.width = 0; canvas.height = 0; } }
  }

  async function upload() {
    if (!photo || !canSend || !consent || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const body = new FormData(); body.set("photo", photo.file); body.set("consent", "yes");
    try {
      const result = await requestJson<{ flash: RoomFlash }>(`/api/rooms/${encodeURIComponent(slug)}/flashes`, { method: "POST", body }, 45_000);
      if (!result.flash?.id) throw new Error("We couldn’t confirm the send. Check Flashes before trying again.");
      onSent(result.flash); onClose();
    } catch (cause) { setError(requestErrorMessage(cause)); }
    finally { pending.current = false; setBusy(false); }
  }

  function resetPhoto() {
    renderController.current?.abort();
    setCaptured(null); setPrepared(null); setConsent(false); setError("");
    setCompare(false); setHolding(false); setDisplayedUrl("");
  }
  function selectLook(value: FlashLook) {
    if (value === look) return;
    renderController.current?.abort();
    setLook(value); setCompare(false); setHolding(false); setError("");
  }
  return <RoomOverlay label={captured ? "Share this Flash" : "Flash camera"} className="room-overlay--immersive" onClose={onClose} beforeClose={() => { stopCamera(); renderController.current?.abort(); }} busy={busy}>{(dismiss) => <section className={`flash-stage flash-capture${captured ? " flash-capture--editing" : ""}`}>
    {!captured && <div className="flash-capture__view">
      <video ref={video} className={`flash-stage__image${facing === "user" ? " is-mirrored" : ""}`} autoPlay playsInline muted aria-label="Live camera preview" />
      <FlashLivePreview video={video} look={look} strength={strength} mirrored={facing === "user"} ready={ready} onReady={setLiveReady} onError={setError} />
    </div>}
    <header className="flash-stage__header"><span><b>{captured ? "Worth a Flash?" : "Catch the moment."}</b><small>{captured ? "One look for everyone else." : "Choose your look. Then catch it."}</small></span><button type="button" aria-label="Close camera" disabled={busy} onClick={dismiss}><X aria-hidden="true" size={22} /></button></header>
    {captured && previewUrl && <div className="flash-capture__preview"
      onPointerDown={event => { if (busy || original || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); }}
      onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onContextMenu={event => event.preventDefault()}>
      <Image fill unoptimized sizes="(min-width: 701px) 560px, 100vw" style={{ objectFit: "contain" }} className="flash-stage__image" src={previewUrl} alt={comparing ? "Original photo for comparison" : `Your Flash before sharing: ${photo ? lookName : "Original, preparing look"}`} draggable={false} onLoad={event => setDisplayedUrl(event.currentTarget.currentSrc)} />
      <span className="flash-capture__look-label" role="status">{comparing ? "Original" : photo ? lookName : error ? "Look not ready" : "Preparing look…"}</span>
    </div>}
    {!captured && !ready && !error && <p className="flash-stage__waiting" role="status"><Camera aria-hidden="true" size={28} />Opening your camera…</p>}
    <footer className="flash-stage__footer">
      {error && <p className="room-surface-error" role="alert">{error}{captured && !photo && <button type="button" onClick={() => { setError(""); setRenderAttempt(value => value + 1); }}>Retry look</button>}</p>}
      {!captured && <FlashLookPicker look={look} strength={strength} disabled={!ready || taking} onLook={selectLook} onStrength={value => { setStrength(value); setError(""); }} />}
      {captured ? <>
        <FlashLookPicker source={captured.canvas} look={look} strength={strength} disabled={busy || taking} onLook={selectLook} onStrength={value => { if (value === strength) return; renderController.current?.abort(); setStrength(value); setCompare(false); setHolding(false); setError(""); }} />
        <div className="flash-looks__compare"><span>Hold photo to compare.</span><button type="button" aria-pressed={compare} disabled={busy || original || !photo} onClick={() => setCompare(value => !value)}>{compare ? "Back to look" : "Show original"}</button></div>
        <label className="flash-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>Everyone pictured is happy to be in this Room.</span></label>
        <div className="flash-capture__actions"><button type="button" disabled={busy} onClick={resetPhoto}>Retake</button><button type="button" className="room-surface-send" disabled={busy || !consent || !canSend} onClick={() => void upload()}>{busy ? "Sending…" : "Send Flash"}<ArrowUp aria-hidden="true" size={19} /></button></div>
      </> : <div className="flash-capture__actions"><span />{error && !ready ? <button type="button" className="room-surface-send" onClick={() => setAttempt((value) => value + 1)}>Try camera again</button> : <button className="flash-shutter" type="button" disabled={!ready || taking || (!original && !liveReady)} aria-label="Take Flash photo" onClick={() => void capturePhoto()}><span /></button>}<button type="button" aria-label="Switch camera" disabled={taking} onClick={() => setFacing((value) => value === "user" ? "environment" : "user")}><RefreshCw aria-hidden="true" size={22} /></button></div>}
      <small className="flash-fine-print">Ten seconds to view. Screenshots are still possible.</small>
    </footer>
  </section>}</RoomOverlay>;
}
