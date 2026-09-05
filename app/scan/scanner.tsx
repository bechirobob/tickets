"use client";

import BrandLogo from "../brand-logo";
import Link from "next/link";
import QrScanner from "qr-scanner";
import { AlertTriangle, CheckCircle2, CloudOff, Keyboard, Loader2, RefreshCw, RotateCcw, ScanLine, Search, Users, Wifi, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StaffRole } from "../../lib/admin-session";
import WorkspaceJump from "../admin/workspace-jump";
import DoorDesk from "./door-desk";

type EventOption = { slug: string; title: string; fullDate: string; venue: string };
type GateTicket = { ticketId?: string; ticketType?: string; attendeeName?: string; checkedInAt?: string; checkedInGate?: string; eventSlug?: string; status?: string };
type GateResult = { result?: "valid" | "invalid" | "duplicate" | "wrong_event"; error?: string; message?: string; ticket?: GateTicket };
type TierStat = { ticketType: string; issued: number; checkedIn: number | null };
type ManifestTicket = { ticketId: string; tokenHash: string; ticketType: string; status: string; attendeeName: string };
type Manifest = { eventSlug: string; generatedAt: string; tickets: ManifestTicket[] };
type QueuedScan = { clientScanId: string; code: string; eventSlug: string; gate: string; deviceId: string; ticket: GateTicket; savedAt: string };
type SearchMatch = GateTicket & { reference?: string; customerName?: string; customerEmail?: string; customerPhone?: string };

const MANIFEST_KEY = "bct:gate-manifests:v1";
const QUEUE_KEY = "bct:gate-queue:v1";
const DEVICE_KEY = "bct:gate-device:v1";

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

function normalizeToken(value: string): string | null {
  const upper = value.trim().toUpperCase();
  const payload = upper.startsWith("BCT:") ? upper.slice(4) : upper;
  const token = payload.replace(/^BCT-/u, "").replaceAll("-", "").replaceAll(" ", "");
  return token.length === 16 ? token : null;
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function Scanner({ actor, role, events }: { actor: string; role: StaffRole; events: EventOption[] }) {
  const [eventSlug, setEventSlug] = useState(events[0]?.slug ?? "");
  const [mode, setMode] = useState<"ready" | "scanning" | "checking" | "valid" | "offline_saved" | "invalid" | "duplicate" | "wrong_event">("ready");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [ticket, setTicket] = useState<GateTicket | undefined>();
  const [stats, setStats] = useState({ checkedIn: 0, issued: 0, tiers: [] as TierStat[] });
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [queued, setQueued] = useState<QueuedScan[]>(() => typeof window === "undefined" ? [] : readJson<QueuedScan[]>(QUEUE_KEY, []));
  const [canUndo, setCanUndo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const busyRef = useRef(false);
  const deviceId = useMemo(() => {
    if (typeof window === "undefined") return "gate-device";
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID(); window.localStorage.setItem(DEVICE_KEY, created); return created;
  }, []);
  const selectedEvent = events.find((event) => event.slug === eventSlug) ?? events[0];

  const saveQueue = useCallback((next: QueuedScan[]) => { setQueued(next); window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next)); }, []);

  const heartbeat = useCallback(async (pendingOfflineScans: number, manifestGeneratedAt?: string | null) => {
    if (!navigator.onLine || !eventSlug) return;
    try { await fetch("/api/admin/check-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "heartbeat", eventSlug, gate: "Main gate", deviceId, pendingOfflineScans, manifestGeneratedAt: manifestGeneratedAt ?? null }) }); } catch { /* The next refresh tries again. */ }
  }, [deviceId, eventSlug]);

  const loadEventState = useCallback(async () => {
    if (!eventSlug) return;
    try {
      const response = await fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}&manifest=1`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { checkedIn: number; issued: number; tiers?: TierStat[]; canUndo?: boolean; manifest?: ManifestTicket[]; generatedAt?: string };
      setStats({ checkedIn: data.checkedIn, issued: data.issued, tiers: data.tiers ?? [] }); setCanUndo(Boolean(data.canUndo));
      const nextManifest = { eventSlug, generatedAt: data.generatedAt ?? new Date().toISOString(), tickets: data.manifest ?? [] };
      setManifest(nextManifest);
      const all = readJson<Record<string, Manifest>>(MANIFEST_KEY, {}); all[eventSlug] = nextManifest; window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(all));
      await heartbeat(readJson<QueuedScan[]>(QUEUE_KEY, []).length, nextManifest.generatedAt);
    } catch {
      const cached = readJson<Record<string, Manifest>>(MANIFEST_KEY, {})[eventSlug] ?? null;
      setManifest(cached);
    }
  }, [eventSlug, heartbeat]);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    const current = readJson<QueuedScan[]>(QUEUE_KEY, []);
    if (!current.length) return;
    const remaining: QueuedScan[] = [];
    let synchronized = 0;
    for (const scan of current) {
      try {
        const response = await fetch("/api/admin/check-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scan) });
        const result = await response.json() as GateResult;
        if (response.ok) synchronized += 1;
        else if (result.result === "duplicate") setMessage(`One offline entry was already admitted elsewhere. ${result.error ?? "Supervisor review may be needed."}`);
        else remaining.push(scan);
      } catch { remaining.push(scan); }
    }
    saveQueue(remaining);
    await heartbeat(remaining.length, manifest?.generatedAt ?? null);
    if (synchronized) { setMessage(`${synchronized} offline ${synchronized === 1 ? "entry" : "entries"} synchronized. The doors agree again.`); await loadEventState(); }
  }, [heartbeat, loadEventState, manifest?.generatedAt, saveQueue]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void syncQueue(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [syncQueue]);
  useEffect(() => { const kick = window.setTimeout(() => void loadEventState(), 0); const timer = window.setInterval(() => { if (navigator.onLine) void loadEventState(); }, 10_000); return () => { window.clearTimeout(kick); window.clearInterval(timer); }; }, [loadEventState]);
  useEffect(() => () => { scannerRef.current?.destroy(); scannerRef.current = null; }, []);

  const offlineCheck = useCallback(async (value: string) => {
    const token = normalizeToken(value);
    const cached = manifest ?? readJson<Record<string, Manifest>>(MANIFEST_KEY, {})[eventSlug] ?? null;
    if (!token || !cached) { setMode("invalid"); setMessage("No usable offline manifest. Reconnect before admitting this guest."); return; }
    const hash = await tokenHash(token);
    const found = cached.tickets.find((item) => item.tokenHash === hash);
    const currentQueue = readJson<QueuedScan[]>(QUEUE_KEY, []);
    if (!found) { setMode("invalid"); setMessage("This ticket is not in the last verified door list. Reconnect before deciding."); return; }
    if (found.status === "checked_in" || currentQueue.some((item) => item.ticket.ticketId === found.ticketId)) {
      setTicket(found); setMode("duplicate"); setMessage("Already admitted on this device or in the last synchronized door list."); return;
    }
    const scan: QueuedScan = { clientScanId: crypto.randomUUID(), code: value, eventSlug, gate: "Main gate", deviceId, ticket: found, savedAt: new Date().toISOString() };
    saveQueue([...currentQueue, scan]); setTicket(found); setMode("offline_saved");
    setMessage("Saved on this gate device. It will synchronize automatically when the signal returns.");
  }, [deviceId, eventSlug, manifest, saveQueue]);

  const checkTicket = useCallback(async (value: string) => {
    if (busyRef.current || !value.trim()) return;
    busyRef.current = true; setMode("checking"); setMessage("");
    if (!navigator.onLine) { await offlineCheck(value); busyRef.current = false; scannerRef.current?.pause(); return; }
    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value, eventSlug, gate: "Main gate", deviceId, clientScanId: crypto.randomUUID() }),
      });
      const result = await response.json() as GateResult;
      setTicket(result.ticket); setMessage(result.error ?? result.message ?? "Entry recorded.");
      setMode(response.ok ? "valid" : result.result === "duplicate" ? "duplicate" : result.result === "wrong_event" ? "wrong_event" : "invalid");
      scannerRef.current?.pause(); if (response.ok) await loadEventState();
    } catch { await offlineCheck(value); }
    finally { busyRef.current = false; }
  }, [deviceId, eventSlug, loadEventState, offlineCheck]);

  async function startCamera() {
    if (!videoRef.current) return;
    setMode("scanning"); setMessage("");
    const scanner = scannerRef.current ?? new QrScanner(videoRef.current, (result) => void checkTicket(result.data), { preferredCamera: "environment", maxScansPerSecond: 8, highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true });
    scannerRef.current = scanner;
    try { await scanner.start(); } catch { setMode("ready"); setMessage("Camera access was not available. Use the ticket code below."); }
  }

  function scanNext() { setCode(""); setTicket(undefined); setMessage(""); if (scannerRef.current) { setMode("scanning"); void scannerRef.current.start(); } else setMode("ready"); }

  async function search() {
    if (searchQuery.trim().length < 2 || !navigator.onLine) return;
    setSearching(true);
    const response = await fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}&q=${encodeURIComponent(searchQuery)}`, { cache: "no-store" });
    const result = await response.json() as { matches?: SearchMatch[]; canUndo?: boolean };
    setMatches(result.matches ?? []); setCanUndo(Boolean(result.canUndo)); setSearching(false);
  }

  async function undo() {
    if (!ticket?.ticketId || !window.confirm("Undo this check-in? The ticket will become scannable again and the action will be audited.")) return;
    const response = await fetch("/api/admin/check-in", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId: ticket.ticketId, eventSlug, gate: "Supervisor", reason: "Door correction" }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Check-in undone. The ticket is live again." : result.error ?? "Check-in could not be undone.");
    if (response.ok) { setMode("ready"); setTicket(undefined); await loadEventState(); }
  }

  return <main className="scanner-page">
    <header className="scanner-header"><Link href="/" className="brand-mark"><BrandLogo section="Gate" /></Link><WorkspaceJump active="/scan" role={role} compact /><span className="scanner-actor">{actor}</span><div className={online ? "online" : "offline"}>{online ? <Wifi size={15} /> : <CloudOff size={15} />}{online ? "Doors synchronized" : `Offline · ${queued.length} queued`}</div></header>
    <div className="scanner-event"><div><small>Now scanning</small><h1>{selectedEvent?.title ?? "Choose an event"}</h1><p>{selectedEvent ? `${selectedEvent.fullDate} · ${selectedEvent.venue}` : "No published events"}</p>{manifest ? <span>Door list saved {new Date(manifest.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : <span>No offline door list yet</span>}</div><label><span>Event</span><select value={eventSlug} onChange={(event) => { scannerRef.current?.pause(); setEventSlug(event.target.value); setMode("ready"); setMatches([]); }}>{events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select></label></div>
    <section className={`scan-surface scan-surface--${mode}`}>
      {(mode === "ready" || mode === "scanning" || mode === "checking") && <><div className="scan-frame"><video ref={videoRef} muted playsInline /><i /><i /><i /><i />{mode === "ready" ? <ScanLine size={76} /> : null}</div><h2>{mode === "checking" ? "Checking ticket…" : mode === "scanning" ? "Position the QR inside the frame" : "Ready for the next guest"}</h2><p>{message || (mode === "ready" ? "Online verifies live. Offline checks the saved door list and queues the entry." : "The ticket scans automatically.")}</p>{mode === "ready" ? <button onClick={startCamera}>Start camera</button> : null}</>}
      {mode === "valid" && <><CheckCircle2 size={92} /><h2>You’re in</h2><strong>{ticket?.ticketType?.replaceAll("-", " ")} · 1 guest</strong><p>{ticket?.attendeeName ?? "Verified attendee"} · Entry recorded now</p><button onClick={scanNext}>Scan next ticket</button></>}
      {mode === "offline_saved" && <><AlertTriangle size={92} /><h2>Saved offline</h2><strong>{ticket?.ticketType?.replaceAll("-", " ")} · This gate device only</strong><p>{message}</p><button onClick={scanNext}>Scan next ticket</button></>}
      {(mode === "invalid" || mode === "wrong_event" || mode === "duplicate") && <><XCircle size={92} /><h2>{mode === "duplicate" ? "Already admitted" : mode === "wrong_event" ? "Wrong event" : "Ticket not recognised"}</h2><strong>{mode === "duplicate" && ticket?.checkedInAt ? `First admitted ${new Date(ticket.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No new entry was recorded"}</strong><p>{message}</p><div className="scanner-result-actions"><button onClick={scanNext}>Scan next ticket</button>{mode === "duplicate" && canUndo ? <button className="scanner-undo" onClick={() => void undo()}><RotateCcw size={14} /> Supervisor undo</button> : null}</div></>}
    </section>
    <section className="manual-entry"><div><Keyboard size={19} /><span><strong>Enter ticket code</strong><small>Use when the camera cannot read the QR</small></span></div><label><Search size={17} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="BCT-XXXX-XXXX-XXXX-XXXX" /><button onClick={() => void checkTicket(code)}>Check</button></label></section>
    <section className="gate-search"><header><Search size={18} /><span><strong>Find a guest or purchase</strong><small>Name, email, phone or payment reference</small></span></header><form onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search the door list" disabled={!online} /><button disabled={!online || searching || searchQuery.trim().length < 2}>{searching ? <Loader2 className="spin" size={14} /> : "Find"}</button></form>{matches.length ? <div>{matches.map((match) => <article key={match.ticketId}><span><b>{match.attendeeName ?? match.customerName ?? "Guest"}</b><small>{match.reference} · {match.ticketType?.replaceAll("-", " ")}</small><small>{match.customerEmail} · {match.customerPhone}</small></span><i className={match.status}>{match.status?.replaceAll("_", " ")}</i></article>)}</div> : null}</section>
    <DoorDesk eventSlug={eventSlug} />
    <footer className="scanner-stats"><span><Users size={17} /><b>{stats.checkedIn}</b> admitted</span><span><b>{Math.max(0, stats.issued - stats.checkedIn)}</b> remaining</span><span><b>{stats.issued}</b> active tickets</span><button type="button" onClick={() => { void loadEventState(); void syncQueue(); }}><RefreshCw size={14} /> Refresh</button>{stats.tiers.map((tier) => <span key={tier.ticketType}><b>{tier.checkedIn ?? 0}/{tier.issued}</b> {tier.ticketType.replaceAll("-", " ")}</span>)}</footer>
  </main>;
}
