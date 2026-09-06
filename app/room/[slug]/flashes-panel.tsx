"use client";

import { Aperture, Camera, Flag, MoreHorizontal, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import RoomOverlay from "../../room-overlay";
import { FlashMarker } from "../../room-chat-parts";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";
import FlashCamera from "./flash-camera";
import FlashViewer from "./flash-viewer";

export type RoomFlash = {
  id: string; attendeeId: string; displayName: string; width: number; height: number;
  createdAt: string; expiresAt: string; mine: boolean; openedAt?: string | null;
};

export default function FlashesPanel({ slug, readOnly, expiresAt, refreshKey, onCount, onFlashes, galleryOpen,
  onGalleryClose, selectedFlashId, onSelectedFlashClose, captureRequest,
}: {
  slug: string; readOnly: boolean; expiresAt: string; refreshKey: number;
  onCount: (count: number) => void; onFlashes: (flashes: RoomFlash[]) => void;
  galleryOpen: boolean; onGalleryClose: () => void; selectedFlashId: string | null;
  onSelectedFlashClose: () => void; captureRequest: number;
}) {
  const [flashes, setFlashes] = useState<RoomFlash[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<RoomFlash | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [managing, setManaging] = useState<RoomFlash | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("nonconsensual");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"unopened" | "all">("unopened");
  const fetchGeneration = useRef(0);
  const receipts = useRef(new Map<string, string>());
  const requestBusy = useRef(false);
  const seenCapture = useRef(0);
  const base = `/api/rooms/${encodeURIComponent(slug)}/flashes`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++fetchGeneration.current;
    if (readOnly) { setFlashes([]); setLoading(false); return; }
    try {
      const result = await requestJson<{ flashes?: RoomFlash[] }>(base, { signal });
      if (current !== fetchGeneration.current || signal?.aborted) return;
      const now = Date.now();
      setFlashes((result.flashes ?? []).filter((flash) => Date.parse(flash.expiresAt) > now).map((flash) => ({ ...flash, openedAt: receipts.current.get(flash.id) ?? flash.openedAt ?? null })));
      setLoadError("");
    } catch (cause) {
      if (current === fetchGeneration.current && !signal?.aborted) setLoadError(requestErrorMessage(cause));
    } finally { if (current === fetchGeneration.current && !signal?.aborted) setLoading(false); }
  }, [base, readOnly]);

  useEffect(() => { const abort = new AbortController(); const timer = setTimeout(() => void load(abort.signal), 0); return () => { clearTimeout(timer); abort.abort(); }; }, [load, refreshKey]);
  useEffect(() => {
    const visible = readOnly ? [] : flashes;
    onFlashes(visible); onCount(visible.filter((flash) => !flash.mine && !flash.openedAt).length);
  }, [flashes, readOnly, onFlashes, onCount]);
  useEffect(() => {
    if (captureRequest <= seenCapture.current) return;
    seenCapture.current = captureRequest;
    if (!readOnly) { const timer = setTimeout(() => setCameraOpen(true), 0); return () => clearTimeout(timer); }
  }, [captureRequest, readOnly]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setFlashes((current) => current.some((flash) => Date.parse(flash.expiresAt) <= now) ? current.filter((flash) => Date.parse(flash.expiresAt) > now) : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const markOpened = useCallback((id: string, at: string) => {
    receipts.current.set(id, at);
    setFlashes((current) => current.map((flash) => flash.id === id ? { ...flash, openedAt: at } : flash));
  }, []);
  const closeView = () => { setViewing(null); onSelectedFlashClose(); };
  const active = viewing ?? flashes.find((flash) => flash.id === selectedFlashId) ?? null;
  const activeExists = active && flashes.some((flash) => flash.id === active.id);

  function manage(flash: RoomFlash, report = false) {
    setManaging(flash); setReporting(report); setError(""); setDetails(""); closeView();
  }
  async function submitManagement() {
    if (!managing || requestBusy.current) return;
    requestBusy.current = true; setBusy(true); setError("");
    try {
      if (managing.mine) await requestJson(`${base}/${encodeURIComponent(managing.id)}`, { method: "DELETE" });
      else await requestJson(`${base}/${encodeURIComponent(managing.id)}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, details }) });
      fetchGeneration.current++;
      setFlashes((current) => current.filter((flash) => flash.id !== managing.id));
      setNotice(managing.mine ? "Flash removed for good." : "Report sent privately. That Flash is hidden from you.");
      setManaging(null); setDetails("");
    } catch (cause) { setError(requestErrorMessage(cause)); }
    finally { requestBusy.current = false; setBusy(false); }
  }

  const unopened = flashes.filter((flash) => !flash.mine && !flash.openedAt);
  const shown = filter === "unopened" ? unopened : flashes;
  if (readOnly) return null;
  return <>
    {notice && <div className="room-media-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss Flash notice" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {galleryOpen && !cameraOpen && !active && !managing && <RoomOverlay label="Room Flashes" className="room-overlay--sheet" onClose={onGalleryClose}>{(dismiss) => <section className="room-sheet flash-inbox">
      <header className="room-sheet__header"><div><span className="room-surface-kicker"><Aperture size={17} /> Flashes</span><h2>You had to be there.</h2><p>Ten seconds. One look. Zero camera-roll archaeology.</p></div><button type="button" aria-label="Close Flashes" onClick={dismiss}><X size={20} /></button></header>
      <button type="button" className="flash-inbox__capture" onClick={() => setCameraOpen(true)}><Camera size={22} /><span><b>Send a Flash</b><small>Show the Room what’s happening.</small></span><span aria-hidden="true">↗</span></button>
      <nav className="room-surface-tabs" aria-label="Filter Flashes"><button type="button" aria-pressed={filter === "unopened"} onClick={() => setFilter("unopened")}>Unopened <span>{unopened.length}</span></button><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All Flashes <span>{flashes.length}</span></button></nav>
      {loading ? <p className="room-surface-empty" role="status">Finding the moments…</p> : loadError ? <div className="room-surface-empty"><p role="alert">{loadError}</p><button type="button" onClick={() => void load()}>Try again</button></div> : shown.length ? <ol className="flash-inbox__list">{shown.map((flash) => <li key={flash.id}>
        <button type="button" className="flash-inbox__open" disabled={Boolean(flash.openedAt) && !flash.mine} aria-label={flash.openedAt && !flash.mine ? `Opened Flash from ${flash.displayName}` : `Open Flash from ${flash.mine ? "you" : flash.displayName}`} onClick={() => setViewing(flash)}><span className="flash-inbox__sender"><b>{flash.mine ? "You" : flash.displayName}</b><time dateTime={flash.createdAt}>{new Date(flash.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span><FlashMarker mine={flash.mine} opened={Boolean(flash.openedAt)} /></button>
        <button type="button" className="flash-inbox__more" aria-label={`Options for Flash from ${flash.mine ? "you" : flash.displayName}`} onClick={() => manage(flash)}><MoreHorizontal size={18} /></button>
      </li>)}</ol> : <div className="room-surface-empty"><Aperture size={28} /><h3>{filter === "unopened" && flashes.length ? "You’re all caught up." : "The camera’s waiting."}</h3><p>{flashes.length ? "The next moment is someone’s to send." : "The outfit. The entrance. The friend who said they weren’t coming."}</p></div>}
      <small className="flash-inbox__privacy">Screenshots are possible. Flashes disappear when this Room closes{expiresAt ? ` on ${new Date(expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}.</small>
    </section>}</RoomOverlay>}
    {cameraOpen && <FlashCamera slug={slug} onClose={() => setCameraOpen(false)} onSent={(flash) => { fetchGeneration.current++; setFlashes((current) => [flash, ...current.filter((item) => item.id !== flash.id)]); setNotice("Sent. Let them have their moment."); }} />}
    {active && activeExists && !cameraOpen && !managing && <FlashViewer key={active.id} slug={slug} flash={active} onOpened={markOpened} onClose={closeView} onReport={() => manage(active, true)} onRemove={() => manage(active)} />}
    {active && !activeExists && <RoomOverlay label="Flash unavailable" className="room-overlay--sheet" onClose={closeView}>{(dismiss) => <section className="room-sheet"><h2>That moment has passed.</h2><p>This Flash was removed or expired.</p><button type="button" onClick={dismiss}>Back to the Room</button></section>}</RoomOverlay>}
    {managing && <RoomOverlay label={managing.mine ? "Remove Flash" : "Flash options"} className="room-overlay--sheet" busy={busy} onClose={() => setManaging(null)}>{(dismiss) => <section className="room-sheet flash-manage">
      <header className="room-sheet__header"><div><span className="room-surface-kicker">{managing.mine ? <Trash2 size={17} /> : <Flag size={17} />} {managing.mine ? "Your Flash" : `From ${managing.displayName}`}</span><h2>{managing.mine ? "Delete this Flash for good?" : reporting ? "Tell us what happened." : "Keep the Room good."}</h2></div><button type="button" aria-label="Close Flash options" disabled={busy} onClick={dismiss}><X size={20} /></button></header>
      {managing.mine ? <p>It disappears for everyone. This cannot be undone.</p> : !reporting ? <button type="button" className="room-surface-choice" onClick={() => setReporting(true)}><Flag size={18} /><span><b>Report this Flash</b><small>Only the moderation team sees your report.</small></span></button> : <>
        <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="nonconsensual">Shared without consent</option><option value="explicit">Explicit content</option><option value="unsafe">Unsafe behaviour</option><option value="spam">Spam</option><option value="other">Other</option></select></label>
        <label>Anything else? <span>(optional)</span><textarea value={details} onChange={(event) => setDetails(event.target.value.slice(0, 500))} placeholder="Help the team understand what happened." /></label></>}
      {error && <p role="alert" className="room-surface-error">{error}</p>}
      {(managing.mine || reporting) && <div className="room-surface-actions"><button type="button" disabled={busy} onClick={dismiss}>Cancel</button><button type="button" className="room-surface-send" disabled={busy} onClick={() => void submitManagement()}>{busy ? "One moment…" : managing.mine ? "Delete Flash" : "Send report"}</button></div>}
    </section>}</RoomOverlay>}
  </>;
}
