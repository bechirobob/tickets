"use client";

import { Camera, Clock3, Flag, ImagePlus, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Flash = {
  id: string;
  attendeeId: string;
  displayName: string;
  width: number;
  height: number;
  createdAt: string;
  expiresAt: string;
  mine: boolean;
};

type PreparedPhoto = { file: File; previewUrl: string };

export default function FlashesPanel({ slug, readOnly, expiresAt, refreshKey, onCount }: {
  slug: string;
  readOnly: boolean;
  expiresAt: string;
  refreshKey: number;
  onCount: (count: number) => void;
}) {
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Flash | null>(null);
  const [reporting, setReporting] = useState<Flash | null>(null);
  const [reportReason, setReportReason] = useState("nonconsensual");
  const [reportDetails, setReportDetails] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (readOnly) {
      setFlashes([]);
      onCount(0);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/flashes`, { cache: "no-store" });
      const result = await response.json() as { flashes?: Flash[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Flashes could not be opened.");
      const next = result.flashes ?? [];
      setFlashes(next);
      onCount(next.length);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Flashes could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [onCount, readOnly, slug]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl); }, [prepared]);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared({ file, previewUrl: URL.createObjectURL(file) });
    setConsent(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function closePrepared() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    setConsent(false);
  }

  async function upload() {
    if (!prepared || !consent || uploading) return;
    setUploading(true);
    const body = new FormData();
    body.set("photo", prepared.file);
    body.set("consent", "yes");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/flashes`, { method: "POST", body });
      const result = await response.json() as { flash?: Flash; error?: string };
      if (!response.ok || !result.flash) throw new Error(result.error ?? "This Flash could not be shared.");
      closePrepared();
      setFlashes((current) => current.some((item) => item.id === result.flash?.id) ? current : [result.flash as Flash, ...current]);
      setNotice("Your Flash is live. It leaves when this Room closes.");
      void load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This Flash could not be shared.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(flash: Flash) {
    if (!window.confirm("Remove your Flash now? It cannot be recovered.")) return;
    const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(flash.id)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setNotice(result.error ?? "The Flash could not be removed."); return; }
    setViewing(null);
    setFlashes((current) => current.filter((item) => item.id !== flash.id));
    setNotice("Flash removed for good.");
    void load();
  }

  async function report() {
    if (!reporting) return;
    const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(reporting.id)}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reportReason, details: reportDetails }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setNotice(result.error ?? "The report could not be sent."); return; }
    setFlashes((current) => current.filter((item) => item.id !== reporting.id));
    setViewing(null);
    setReporting(null);
    setReportDetails("");
    setNotice("Report sent privately. That Flash is hidden from you.");
    void load();
  }

  const guardImage = { onContextMenu: (event: React.MouseEvent) => event.preventDefault(), onDragStart: (event: React.DragEvent) => event.preventDefault(), draggable: false };

  if (readOnly) return <section className="flashes-closed"><ShieldCheck /><p className="eyebrow">The moment passed</p><h2>This Room&apos;s Flashes are gone.</h2><p>The chat stays as an archive. The photos do not.</p></section>;

  return <section className="flashes-view">
    <header className="flashes-intro">
      <div><p className="eyebrow">Only here. Only now.</p><h2>Flashes</h2><p>Selfies, drinks and whatever made the night. No downloads. No forwarding. Gone when this Room closes.</p></div>
      <div className="flashes-intro__actions">
        <span><Clock3 size={13} /> Clears {new Date(expiresAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <button type="button" onClick={() => inputRef.current?.click()}><ImagePlus size={17} /> Share a Flash</button>
        <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event.target.files?.[0])} />
      </div>
    </header>
    {notice && <button className="flashes-notice" onClick={() => setNotice("")}>{notice}<span>Dismiss</span></button>}
    {loading ? <div className="flashes-empty"><Camera /><p>Opening tonight&apos;s Flashes…</p></div> : flashes.length === 0 ? <div className="flashes-empty"><Camera /><h3>Nothing here yet.</h3><p>Be the first to leave something worth seeing—and not worth keeping forever.</p><button type="button" onClick={() => inputRef.current?.click()}>Share the first Flash</button></div> : <div className="flashes-grid">
      {flashes.map((flash) => <button type="button" className="flash-card" key={flash.id} onClick={() => setViewing(flash)} aria-label={`Open Flash from ${flash.mine ? "you" : flash.displayName}`}>
        {/* Private, cookie-authorised media must bypass the public image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(flash.id)}`} alt={`Flash shared by ${flash.mine ? "you" : flash.displayName}`} {...guardImage} />
        <span><b>{flash.mine ? "You" : flash.displayName}</b><time>{new Date(flash.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
      </button>)}
    </div>}
    <footer className="flashes-footnote"><ShieldCheck size={14} /><span>BeCore removes the file when this Room closes. Someone could still photograph a screen with another device—share accordingly.</span></footer>

    {prepared && <div className="flash-modal" role="dialog" aria-modal="true" aria-label="Share a Flash">
      <section className="flash-share">
        <header><div><p className="eyebrow">Share a Flash</p><h2>Looks like tonight.</h2></div><button onClick={closePrepared} aria-label="Close"><X /></button></header>
        {/* Local preview never leaves this device until Share is pressed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={prepared.previewUrl} alt="Your Flash preview" {...guardImage} />
        <p>We resize it, remove camera and location metadata, and run a safety check before anybody sees it.</p>
        <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Everyone pictured is comfortable with this being shared in the Room.</span></label>
        <button onClick={upload} disabled={!consent || uploading}>{uploading ? "Checking the moment…" : "Share to Flashes"}</button>
      </section>
    </div>}

    {viewing && <div className="flash-modal flash-modal--viewer" role="dialog" aria-modal="true" aria-label={`Flash from ${viewing.mine ? "you" : viewing.displayName}`}>
      <section>
        <header><div><b>{viewing.mine ? "Your Flash" : viewing.displayName}</b><time>{new Date(viewing.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><button onClick={() => setViewing(null)} aria-label="Close"><X /></button></header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/rooms/${encodeURIComponent(slug)}/flashes/${encodeURIComponent(viewing.id)}`} alt={`Flash shared by ${viewing.mine ? "you" : viewing.displayName}`} {...guardImage} />
        <footer><span><Clock3 size={13} /> Gone when the Room closes</span>{viewing.mine ? <button onClick={() => remove(viewing)}><Trash2 size={14} /> Remove now</button> : <button onClick={() => { setReporting(viewing); setViewing(null); }}><Flag size={14} /> Report privately</button>}</footer>
      </section>
    </div>}

    {reporting && <div className="room-modal" role="dialog" aria-modal="true"><section><Flag /><p className="eyebrow">Private report</p><h2>What&apos;s wrong with this Flash?</h2><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="nonconsensual">Shared without consent</option><option value="explicit">Explicit content</option><option value="unsafe">Unsafe or violent</option><option value="spam">Spam</option><option value="other">Other</option></select></label><label>Details<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 500))} placeholder="Optional context for the moderator" /></label><div><button onClick={() => setReporting(null)}>Cancel</button><button onClick={report}>Send report</button></div></section></div>}
  </section>;
}
