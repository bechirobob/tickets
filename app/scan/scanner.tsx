"use client";

import Link from "next/link";
import QrScanner from "qr-scanner";
import { CheckCircle2, Keyboard, ScanLine, Search, Signal, Users, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type EventOption = { slug: string; title: string; fullDate: string; venue: string };
type GateResult = {
  result?: "valid" | "invalid" | "duplicate" | "wrong_event";
  error?: string;
  ticket?: { ticketType?: string; attendeeName?: string; checkedInAt?: string; checkedInGate?: string; eventSlug?: string };
};

export default function Scanner({ events }: { events: EventOption[] }) {
  const [eventSlug, setEventSlug] = useState(events[0]?.slug ?? "");
  const [mode, setMode] = useState<"ready" | "scanning" | "checking" | "valid" | "invalid" | "duplicate" | "wrong_event">("ready");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [ticket, setTicket] = useState<GateResult["ticket"]>(undefined);
  const [stats, setStats] = useState({ checkedIn: 0, issued: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const busyRef = useRef(false);
  const selectedEvent = events.find((event) => event.slug === eventSlug) ?? events[0];

  const loadStats = useCallback(async () => {
    if (!eventSlug) return;
    const response = await fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}`, { cache: "no-store" });
    if (response.ok) setStats(await response.json() as { checkedIn: number; issued: number });
  }, [eventSlug]);

  useEffect(() => {
    if (!eventSlug) return;
    let cancelled = false;
    void fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ checkedIn: number; issued: number }> : null)
      .then((nextStats) => { if (!cancelled && nextStats) setStats(nextStats); });
    return () => { cancelled = true; };
  }, [eventSlug]);
  useEffect(() => () => { scannerRef.current?.destroy(); scannerRef.current = null; }, []);

  const checkTicket = useCallback(async (value: string) => {
    if (busyRef.current || !value.trim()) return;
    busyRef.current = true;
    setMode("checking");
    setMessage("");
    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value, eventSlug, gate: "Main gate" }),
      });
      const result = await response.json() as GateResult;
      setTicket(result.ticket);
      setMessage(result.error ?? "Entry recorded.");
      setMode(response.ok ? "valid" : result.result === "duplicate" ? "duplicate" : result.result === "wrong_event" ? "wrong_event" : "invalid");
      scannerRef.current?.pause();
      if (response.ok) await loadStats();
    } catch {
      setMode("invalid");
      setMessage("The gate service is temporarily unavailable. No entry was recorded.");
    } finally {
      busyRef.current = false;
    }
  }, [eventSlug, loadStats]);

  async function startCamera() {
    if (!videoRef.current) return;
    setMode("scanning");
    setMessage("");
    const scanner = scannerRef.current ?? new QrScanner(videoRef.current, (result) => void checkTicket(result.data), {
      preferredCamera: "environment",
      maxScansPerSecond: 8,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
    });
    scannerRef.current = scanner;
    try { await scanner.start(); }
    catch { setMode("ready"); setMessage("Camera access was not available. Use the ticket code below."); }
  }

  function scanNext() {
    setCode("");
    setTicket(undefined);
    setMessage("");
    if (scannerRef.current) { setMode("scanning"); void scannerRef.current.start(); }
    else setMode("ready");
  }

  return <main className="scanner-page">
    <header className="scanner-header"><Link href="/admin" className="brand-mark"><span className="brand-mark__box">B</span><span>Gate</span></Link><div><Signal size={15} /> Secure staff session</div></header>
    <div className="scanner-event"><div><small>Now scanning</small><h1>{selectedEvent?.title ?? "Choose an event"}</h1><p>{selectedEvent ? `${selectedEvent.fullDate} · ${selectedEvent.venue}` : "No published events"}</p></div><label><span>Event</span><select value={eventSlug} onChange={(event) => { scannerRef.current?.pause(); setEventSlug(event.target.value); setMode("ready"); }}>{events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select></label></div>
    <section className={`scan-surface scan-surface--${mode}`}>
      {(mode === "ready" || mode === "scanning" || mode === "checking") && <><div className="scan-frame"><video ref={videoRef} muted playsInline /><i /><i /><i /><i />{mode === "ready" ? <ScanLine size={76} /> : null}</div><h2>{mode === "checking" ? "Checking ticket…" : mode === "scanning" ? "Position the QR inside the frame" : "Ready for the next guest"}</h2><p>{message || (mode === "ready" ? "Camera access starts only when gate staff asks for it." : "The ticket scans automatically.")}</p>{mode === "ready" ? <button onClick={startCamera}>Start camera</button> : null}</>}
      {mode === "valid" && <><CheckCircle2 size={92} /><h2>Ticket valid</h2><strong>{ticket?.ticketType?.replaceAll("-", " ")} · 1 guest</strong><p>{ticket?.attendeeName ?? "Verified attendee"} · Entry recorded now</p><button onClick={scanNext}>Scan next ticket</button></>}
      {(mode === "invalid" || mode === "wrong_event" || mode === "duplicate") && <><XCircle size={92} /><h2>{mode === "duplicate" ? "Already admitted" : mode === "wrong_event" ? "Wrong event" : "Ticket not recognised"}</h2><strong>{mode === "duplicate" && ticket?.checkedInAt ? `First admitted ${new Date(ticket.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No new entry was recorded"}</strong><p>{message}</p><button onClick={scanNext}>Scan next ticket</button></>}
    </section>
    <section className="manual-entry"><div><Keyboard size={19} /><span><strong>Enter ticket code</strong><small>Use when the camera cannot read the QR</small></span></div><label><Search size={17} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="BCT-XXXX-XXXX-XXXX-XXXX" /><button onClick={() => void checkTicket(code)}>Check</button></label></section>
    <footer className="scanner-stats"><span><Users size={17} /><b>{stats.checkedIn}</b> admitted</span><span><b>{Math.max(0, stats.issued - stats.checkedIn)}</b> remaining</span><span><b>{stats.issued}</b> active passes</span></footer>
  </main>;
}
