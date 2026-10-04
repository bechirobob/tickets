"use client";

import QrScanner from "qr-scanner";
import { beginGateAccess, clearGateManifests, readGateManifest, saveGateManifest, type GateAccess, type GateManifest as Manifest, type ManifestTicket } from "../../lib/scanner-manifest";
import { AlertTriangle, CheckCircle2, CloudOff, Keyboard, Loader2, RefreshCw, RotateCcw, ScanLine, Search, Users, Wifi, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GATE_QUEUE_KEY as QUEUE_KEY, GATE_REVIEW_KEY, readGateList, persistGateSync, gateConnectionState, selectedGateEvent, type GateTicket, type QueuedScan, type GateReview } from "../../lib/scanner-sync";
import type { StaffRole } from "../../lib/admin-session";
import WorkspaceChrome from "../workspace-chrome";
import DoorDesk from "./door-desk";

type EventOption = { slug: string; title: string; fullDate: string; venue: string };
type GateResult = { result?: "valid" | "invalid" | "duplicate" | "wrong_event" | "unavailable"; error?: string; message?: string; ticket?: GateTicket };
type TierStat = { ticketType: string; issued: number; checkedIn: number | null };
type SearchMatch = GateTicket & { reference?: string; customerName?: string; customerEmail?: string; customerPhone?: string };

const DEVICE_KEY = "bct:gate-device:v1";

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

export default function Scanner({ actor, role, events, initialEvent, access }: { actor: string; role: StaffRole; access: GateAccess; events: EventOption[]; initialEvent?: string }) {
  const params = useSearchParams();
  const eventSlug = selectedGateEvent(events, params.get("event") ?? initialEvent);
  const currentEvent = useRef(eventSlug);
  useEffect(() => { currentEvent.current = eventSlug; }, [eventSlug]);
  const [mode, setMode] = useState<"ready" | "scanning" | "checking" | "valid" | "offline_saved" | "invalid" | "duplicate" | "wrong_event" | "unavailable" | "unconfirmed">("ready");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [ticket, setTicket] = useState<GateTicket | undefined>();
  const [stats, setStats] = useState({ checkedIn: 0, issued: 0, tiers: [] as TierStat[] });
  const [online, setOnline] = useState(true);
  const [connection, setConnection] = useState({ event: '', reachable: false, lastContact: 0, lastSync: 0 });
  const [clock, setClock] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [reviews, setReviews] = useState<GateReview[]>([]);
  const syncBusy = useRef(false), refreshBusy = useRef('');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);
  const [queued, setQueued] = useState<QueuedScan[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const busyRef = useRef(false), gateAccessDenied = useRef(false);
  const startingRef = useRef(false);
  const cameraGeneration = useRef(0);
  const checkTicketRef = useRef<(value: string) => Promise<void>>(async () => {});
  const deviceId = useMemo(() => {
    if (typeof window === "undefined") return "gate-device";
    try {
      const existing = window.localStorage.getItem(DEVICE_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID(); window.localStorage.setItem(DEVICE_KEY, created); return created;
    } catch { return crypto.randomUUID(); }
  }, []);
  const { accountId, sessionId, expiresAt } = access;
  useEffect(() => {
    try { beginGateAccess(window.localStorage, { accountId, sessionId, expiresAt }); }
    catch { gateAccessDenied.current = true; }
  }, [accountId, sessionId, expiresAt]);
  const selectedEvent = events.find((event) => event.slug === eventSlug) ?? events[0];

  const pending = queued.filter(item => item.eventSlug === eventSlug).length;
  const openReviews = reviews.filter(item => item.eventSlug === eventSlug && !item.reviewedAt);
  const connected = connection.event === eventSlug ? connection : { reachable: false, lastContact: 0, lastSync: 0 };
  const connectionState = gateConnectionState({ online, ...connected, now: clock, pending, reviews: openReviews.length, syncing });
  const connectionLabel = { offline: 'Offline', review: 'Needs supervisor review', syncing: 'Synchronizing entries…', disconnected: 'Connection not confirmed', pending: 'Entries waiting to sync', connected: 'Connected' }[connectionState];

  const saveQueue = useCallback((next: QueuedScan[]) => {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    setQueued(next);
  }, []);
  const markContact = useCallback((slug: string, reachable: boolean, synchronized = false) => {
    if (slug !== currentEvent.current) return;
    const now = Date.now(); setClock(now);
    setConnection(current => ({ event: slug, reachable, lastContact: reachable ? now : current.event === slug ? current.lastContact : 0, lastSync: synchronized ? now : current.event === slug ? current.lastSync : 0 }));
  }, []);

  const denyGateAccess = useCallback((response?: Response) => {
    if (response && response.status !== 401 && response.status !== 403) return false;
    gateAccessDenied.current = true;
    try { clearGateManifests(window.localStorage, response ? undefined : access); } catch { /* The in-memory denial still wins. */ }
    setManifest(null); setCanUndo(false); setMatches([]); setMode("unavailable");
    setMessage("Gate access could not be confirmed. Reload and sign in before scanning.");
    return true;
  }, [access]);

  const heartbeat = useCallback(async (pendingOfflineScans: number, manifestGeneratedAt?: string | null) => {
    if (!navigator.onLine || !eventSlug) return;
    try {
      const response = await fetch("/api/admin/check-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "heartbeat", eventSlug, gate: "Main gate", deviceId, pendingOfflineScans, manifestGeneratedAt: manifestGeneratedAt ?? null }), signal: AbortSignal.timeout(10_000) });
      if (denyGateAccess(response) || !response.ok) markContact(eventSlug, false);
    } catch { markContact(eventSlug, false); }
  }, [denyGateAccess, deviceId, eventSlug, markContact]);

  const loadEventState = useCallback(async () => {
    if (!eventSlug || refreshBusy.current === eventSlug) return;
    refreshBusy.current = eventSlug;
    try {
      const response = await fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}&manifest=1`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (eventSlug !== currentEvent.current) return;
      if (!response.ok) {
        denyGateAccess(response);
        markContact(eventSlug, false); setSyncMessage(response.status === 401 || response.status === 403 ? 'Gate access could not be confirmed. Sign in again before scanning.' : 'The live door list is unavailable. Showing the last saved list.'); return;
      }
      const data = await response.json() as { checkedIn: number; issued: number; tiers?: TierStat[]; canUndo?: boolean; manifest?: ManifestTicket[]; generatedAt?: string; access?: GateAccess };
      if (eventSlug !== currentEvent.current) return;
      if (!Array.isArray(data.manifest) || !Number.isFinite(data.checkedIn) || !Number.isFinite(data.issued)) throw new Error('Unreadable door list');
      setStats({ checkedIn: data.checkedIn, issued: data.issued, tiers: data.tiers ?? [] }); setCanUndo(Boolean(data.canUndo));
      const nextManifest = { eventSlug, generatedAt: data.generatedAt ?? new Date().toISOString(), tickets: data.manifest ?? [], access: data.access! };
      try {
        if (!saveGateManifest(window.localStorage, access, nextManifest)) { denyGateAccess(); markContact(eventSlug, false); setSyncMessage("Gate access changed. Reload and sign in before scanning."); return; }
        setManifest(nextManifest);
        const waiting = readGateList<QueuedScan>(window.localStorage, QUEUE_KEY).filter(item => item.eventSlug === eventSlug).length;
        const unresolved = readGateList<GateReview>(window.localStorage, GATE_REVIEW_KEY).filter(item => item.eventSlug === eventSlug && !item.reviewedAt).length;
        setStorageError(''); markContact(eventSlug, true, waiting === 0 && unresolved === 0);
        await heartbeat(waiting + unresolved, nextManifest.generatedAt);
      } catch { markContact(eventSlug, false); setStorageError('This device cannot save door records. Keep it connected; do not admit guests offline.'); }
    } catch {
      if (eventSlug !== currentEvent.current) return;
      markContact(eventSlug, false);
      setManifest(readGateManifest(window.localStorage, access, eventSlug));
      setSyncMessage('Cannot reach the door service. Your saved entries remain on this device.');
    } finally { if (refreshBusy.current === eventSlug) refreshBusy.current = ''; }
  }, [access, denyGateAccess, eventSlug, heartbeat, markContact]);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine || syncBusy.current || !eventSlug) return;
    syncBusy.current = true; setSyncing(true);
    try {
      const current = readGateList<QueuedScan>(window.localStorage, QUEUE_KEY).filter(item => item.eventSlug === eventSlug);
      if (!current.length) return;
      const completed = new Set<string>(), conflicts: GateReview[] = [];
      let synchronized = 0;
      for (const scan of current) {
        if (currentEvent.current !== eventSlug) break;
        try {
          const response = await fetch("/api/admin/check-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scan), signal: AbortSignal.timeout(10_000) });
          if (denyGateAccess(response)) { markContact(eventSlug, false); break; }
          const result = await response.json() as GateResult;
          if (response.ok && result.result === 'valid') { synchronized += 1; completed.add(scan.clientScanId); markContact(eventSlug, true); }
          else if (['duplicate', 'invalid', 'wrong_event', 'unavailable'].includes(result.result ?? '') && [404, 409].includes(response.status)) {
            conflicts.push({ clientScanId: scan.clientScanId, eventSlug, ticket: result.ticket ?? scan.ticket, savedAt: scan.savedAt, recordedAt: new Date().toISOString(), reason: result.error ?? 'The saved entry needs supervisor review.' });
            completed.add(scan.clientScanId); markContact(eventSlug, true);
          } else { markContact(eventSlug, false); break; }
        } catch { markContact(eventSlug, false); break; }
      }
      const saved = persistGateSync(window.localStorage, completed, conflicts);
      setQueued(saved.remaining); setReviews(saved.reviews); setStorageError('');
      const remaining = saved.remaining.filter(item => item.eventSlug === eventSlug).length;
      const unresolved = saved.reviews.filter(item => item.eventSlug === eventSlug && !item.reviewedAt).length;
      if (currentEvent.current === eventSlug) {
        setSyncMessage(`${synchronized} ${synchronized === 1 ? 'entry synchronized' : 'entries synchronized'}.${remaining ? ` ${remaining} still waiting.` : ''}${unresolved ? ` ${unresolved} need supervisor review.` : ''}`);
        await heartbeat(remaining + unresolved, manifestRef.current?.eventSlug === eventSlug ? manifestRef.current.generatedAt : null);
        if (synchronized) await loadEventState();
      }
    } catch { setStorageError('Door records could not be saved. Keep this device open and ask a supervisor; do not clear its storage.'); }
    finally { syncBusy.current = false; setSyncing(false); }
  }, [denyGateAccess, eventSlug, heartbeat, loadEventState, markContact]);

  useEffect(() => {
    const initialConnection = window.setTimeout(() => {
      setOnline(navigator.onLine); setClock(Date.now());
      try { setQueued(readGateList<QueuedScan>(window.localStorage, QUEUE_KEY)); setReviews(readGateList<GateReview>(window.localStorage, GATE_REVIEW_KEY)); }
      catch { setStorageError('Saved door records are unavailable. Ask a supervisor before scanning offline.'); }
    }, 0);
    const onOnline = () => { setOnline(true); void syncQueue(); void loadEventState(); };
    const onOffline = () => { setOnline(false); markContact(eventSlug, false); };
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => { window.clearTimeout(initialConnection); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [eventSlug, syncQueue, loadEventState, markContact]);
  useEffect(() => {
    const reset = window.setTimeout(() => { cameraGeneration.current++; scannerRef.current?.stop(); setMode('ready'); setTicket(undefined); setMatches([]); setMessage(''); setSyncMessage(''); setManifest(readGateManifest(window.localStorage, access, eventSlug)); setStats({ checkedIn: 0, issued: 0, tiers: [] }); }, 0);
    return () => window.clearTimeout(reset);
  }, [access, eventSlug]);
  useEffect(() => {
    const refresh = () => { setClock(Date.now()); if (navigator.onLine) { void loadEventState(); void syncQueue(); } };
    const kick = window.setTimeout(refresh, 0), timer = window.setInterval(refresh, 10_000);
    return () => { window.clearTimeout(kick); window.clearInterval(timer); };
  }, [loadEventState, syncQueue]);
  useEffect(() => () => { cameraGeneration.current++; scannerRef.current?.destroy(); scannerRef.current = null; }, []);

  function acknowledgeReview(id: string) {
    if (role !== 'owner') return;
    try {
      const next = readGateList<GateReview>(window.localStorage, GATE_REVIEW_KEY).map(item => item.clientScanId === id && item.eventSlug === eventSlug ? { ...item, reviewedAt: new Date().toISOString() } : item);
      window.localStorage.setItem(GATE_REVIEW_KEY, JSON.stringify(next)); setReviews(next);
      setSyncMessage('Review recorded on this device. The ticket’s check-in status is unchanged.'); void loadEventState();
    } catch { setStorageError('The review could not be saved. Keep this device open and try again.'); }
  }

  const offlineCheck = useCallback(async (value: string, clientScanId = crypto.randomUUID()) => {
    const token = normalizeToken(value);
    const cached = gateAccessDenied.current ? null : readGateManifest(window.localStorage, access, eventSlug);
    if (!token || !cached) { setMode("invalid"); setMessage("No usable offline manifest. Reconnect before admitting this guest."); return; }
    const hash = await tokenHash(token);
    if (eventSlug !== currentEvent.current) return;
    const current = gateAccessDenied.current ? null : readGateManifest(window.localStorage, access, eventSlug);
    if (!current || current.generatedAt !== cached.generatedAt) { setMode("unavailable"); setMessage("Gate access or the saved list changed. Reconnect before admitting this guest."); return; }
    const found = current.tickets.find((item) => item.tokenHash === hash);
    let currentQueue: QueuedScan[];
    try { currentQueue = readGateList<QueuedScan>(window.localStorage, QUEUE_KEY);
      const unresolved = readGateList<GateReview>(window.localStorage, GATE_REVIEW_KEY).some(item => item.eventSlug === eventSlug && item.ticket.ticketId === found?.ticketId && !item.reviewedAt);
      if (unresolved) { setMode('duplicate'); setMessage('This entry is already waiting for supervisor review on this device.'); return; } }
    catch { setMode('unavailable'); setMessage('Saved entries cannot be read. Ask a supervisor before admitting this guest.'); return; }
    if (!found) { setMode("invalid"); setMessage("This ticket is not in the last verified door list. Reconnect before deciding."); return; }
    if (found.status === "checked_in" || currentQueue.some((item) => item.ticket.ticketId === found.ticketId)) {
      setTicket(found); setMode("duplicate"); setMessage("Already admitted on this device or in the last synchronized door list."); return;
    }
    const scan: QueuedScan = { clientScanId, code: value, eventSlug, gate: "Main gate", deviceId, ticket: found, savedAt: new Date().toISOString() };
    try { saveQueue([...currentQueue, scan]); }
    catch { setMode('unavailable'); setStorageError('This device cannot save entries. Reconnect before admitting guests.'); setMessage('Entry could not be saved. Do not admit this guest until the connection is restored.'); return; }
    setTicket(found); setMode("offline_saved");
    setMessage("Saved on this gate device. It will synchronize automatically when the signal returns.");
  }, [access, deviceId, eventSlug, saveQueue]);

  const checkTicket = useCallback(async (value: string) => {
    if (busyRef.current || !value.trim()) return;
    busyRef.current = true; const clientScanId = crypto.randomUUID(); scannerRef.current?.pause(true); setMode("checking"); setMessage("");
    if (!navigator.onLine) { try { await offlineCheck(value, clientScanId); } finally { busyRef.current = false; } return; }
    try {
      const response = await fetch("/api/admin/check-in", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value, eventSlug, gate: "Main gate", deviceId, clientScanId }), signal: AbortSignal.timeout(10_000),
      });
      if (denyGateAccess(response)) { markContact(eventSlug, false); return; }
      const result = await response.json().catch(() => { if (response.ok) throw new Error('Unreadable check-in result'); return { error: "Gate access or entry could not be confirmed. Refresh before trying again." }; }) as GateResult;
      if (eventSlug !== currentEvent.current) return;
      if (response.ok && result.result !== 'valid') throw new Error('Unconfirmed check-in result');
      markContact(eventSlug, response.ok || response.status === 409);
      setTicket(result.ticket); setMessage(result.error ?? result.message ?? "Entry recorded.");
      setMode(response.ok ? "valid" : response.status >= 500 ? "unconfirmed" : result.result === "duplicate" ? "duplicate" : result.result === "wrong_event" ? "wrong_event" : result.result === "unavailable" ? "unavailable" : "invalid");
      scannerRef.current?.pause(); if (response.ok) void loadEventState();
    } catch { markContact(eventSlug, false); if (eventSlug === currentEvent.current) await offlineCheck(value, clientScanId); }
    finally { busyRef.current = false; }
  }, [denyGateAccess, deviceId, eventSlug, loadEventState, offlineCheck, markContact]);

  // The decoder lives longer than a render; always use the current event and manifest.
  useEffect(() => { checkTicketRef.current = checkTicket; }, [checkTicket]);

  async function startCamera() {
    if (startingRef.current || busyRef.current || !videoRef.current) return;
    startingRef.current = true;
    const generation = ++cameraGeneration.current;
    setMode("scanning"); setMessage("");
    try {
      // Allow React to reveal the retained video before measuring the scan region.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (generation !== cameraGeneration.current || !videoRef.current) return;
      const scanner = scannerRef.current ?? new QrScanner(videoRef.current, (result) => void checkTicketRef.current(result.data), { preferredCamera: "environment", maxScansPerSecond: 8, highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true });
      scannerRef.current = scanner;
      await scanner.start();
      if (generation !== cameraGeneration.current) scanner.stop();
    } catch (error) {
      console.warn("Ticket camera could not start", error);
      if (generation === cameraGeneration.current) {
        scannerRef.current?.stop();
        setMode("ready"); setMessage("Camera access was not available. Try Start camera again or use the ticket code below.");
      }
    } finally { startingRef.current = false; }
  }

  function scanNext() { setCode(""); setTicket(undefined); setMessage(""); void startCamera(); }

  async function search() {
    if (searchQuery.trim().length < 2 || !navigator.onLine || searching) return;
    setSearching(true);
    try {
      const response = await fetch(`/api/admin/check-in?eventSlug=${encodeURIComponent(eventSlug)}&q=${encodeURIComponent(searchQuery)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (denyGateAccess(response)) { markContact(eventSlug, false); return; }
      const result = await response.json() as { matches?: SearchMatch[]; canUndo?: boolean; error?: string };
      if (eventSlug !== currentEvent.current) return;
      if (!response.ok) throw new Error(result.error ?? 'Guest search is unavailable.');
      setMatches(result.matches ?? []); setCanUndo(Boolean(result.canUndo)); markContact(eventSlug, true);
      setSyncMessage(result.matches?.length ? '' : 'No matching guest found.');
    } catch { markContact(eventSlug, false); setSyncMessage('Guest search could not be completed. Reconnect and try again.'); }
    finally { setSearching(false); }
  }

  async function undo() {
    if (!ticket?.ticketId || !window.confirm("Undo this check-in? The ticket will become scannable again and the action will be audited.")) return;
    try {
      const response = await fetch("/api/admin/check-in", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId: ticket.ticketId, eventSlug, gate: "Supervisor", reason: "Door correction" }), signal: AbortSignal.timeout(10_000) });
      if (denyGateAccess(response)) { markContact(eventSlug, false); return; }
      const result = await response.json() as { error?: string };
      if (eventSlug !== currentEvent.current) return;
      setMessage(response.ok ? "Check-in undone. The ticket is live again." : result.error ?? "Check-in could not be undone.");
      if (response.ok) { setMode("ready"); setTicket(undefined); await loadEventState(); }
    } catch { markContact(eventSlug, false); setMessage('The correction could not be confirmed. Refresh the door list before trying again.'); }
  }

  return <main className="scanner-page">
    <WorkspaceChrome actor={actor} role={role} active="/scan"/><section className="workspace-scanner"><header className="scanner-header"><div className={connectionState === 'connected' ? "online" : "offline"} role="status">{connectionState === 'connected' ? <Wifi size={15} /> : <CloudOff size={15} />}{connectionLabel}</div><p>{pending} waiting · {openReviews.length} to review{connected.lastSync ? ` · Last synced ${new Date(connected.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · No confirmed sync yet'}</p></header>
    {storageError ? <p role="alert">{storageError}</p> : null}
    {syncMessage ? <p role="status">{syncMessage}</p> : null}
    {openReviews.length ? <section className="gate-search" aria-label="Offline entries needing review"><header><AlertTriangle size={18}/><strong>Supervisor review</strong></header><p>These entries were saved on this device but conflict with the live door record. Keep them here until a supervisor checks what happened.</p>{openReviews.map(item => <article key={item.clientScanId}><div><b>{item.ticket.attendeeName ?? 'Guest'} · {item.ticket.ticketType?.replaceAll('-', ' ')}</b><p>{item.reason}</p><small>Saved {new Date(item.savedAt).toLocaleString('en-GH')} · {item.ticket.ticketId?.slice(-8)}</small></div>{role === 'owner' ? <button onClick={() => acknowledgeReview(item.clientScanId)}>Mark reviewed</button> : <span>Ask a supervisor</span>}</article>)}</section> : null}
    <div className="scanner-event"><div><small>Now scanning</small><h1>{selectedEvent?.title ?? "Choose an event"}</h1><p>{selectedEvent ? `${selectedEvent.fullDate} · ${selectedEvent.venue}` : "No published events"}</p>{manifest?.eventSlug === eventSlug ? <span>Door list saved {new Date(manifest.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : <span>No offline door list yet</span>}</div><label><span>Event</span><select value={eventSlug} disabled={mode === "checking" || syncing} onChange={(event) => { const next = new URLSearchParams(params.toString()); next.set("event", event.target.value); window.history.pushState(null, "", `/scan?${next}`); }}>{events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select></label></div>
    <section className={`scan-surface scan-surface--${mode}`}>
      <div style={{ display: ["ready", "scanning", "checking"].includes(mode) ? "flex" : "none", flexDirection: "column", alignItems: "center" }}><div className="scan-frame"><video ref={videoRef} muted playsInline /><i /><i /><i /><i />{mode === "ready" ? <ScanLine size={76} /> : null}</div><h2>{mode === "checking" ? "Checking ticket…" : mode === "scanning" ? "Position the QR inside the frame" : "Ready for the next guest"}</h2><p>{message || (mode === "ready" ? "Online verifies live. Offline checks the saved door list and queues the entry." : "The ticket scans automatically.")}</p>{mode === "ready" ? <button onClick={startCamera}>Start camera</button> : null}</div>
      {mode === "valid" && <><CheckCircle2 size={92} /><h2>You’re in</h2><strong>{ticket?.ticketType?.replaceAll("-", " ")} · 1 guest</strong><p>{ticket?.attendeeName ?? "Verified attendee"} · Entry recorded now</p><button onClick={scanNext}>Scan next ticket</button></>}
      {mode === "offline_saved" && <><AlertTriangle size={92} /><h2>Saved offline</h2><strong>{ticket?.ticketType?.replaceAll("-", " ")} · This gate device only</strong><p>{message}</p><button onClick={scanNext}>Scan next ticket</button></>}
      {(mode === "invalid" || mode === "wrong_event" || mode === "duplicate" || mode === "unavailable" || mode === "unconfirmed") && <><XCircle size={92} /><h2>{mode === "duplicate" ? "Already admitted" : mode === "wrong_event" ? "Wrong event" : mode === "unavailable" ? "Entry is paused" : mode === "unconfirmed" ? "Entry not confirmed" : "Ticket not recognised"}</h2><strong>{mode === "duplicate" && ticket?.checkedInAt ? `First admitted ${new Date(ticket.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : mode === "unconfirmed" ? "Check the live record before admitting this guest" : "No new entry was recorded"}</strong><p>{message}</p><div className="scanner-result-actions"><button onClick={scanNext}>Scan next ticket</button>{mode === "duplicate" && canUndo ? <button className="scanner-undo" onClick={() => void undo()}><RotateCcw size={14} /> Supervisor undo</button> : null}</div></>}
    </section>
    <section className="manual-entry"><div><Keyboard size={19} /><span><strong>Enter ticket code</strong><small>Use when the camera cannot read the QR</small></span></div><label><Search size={17} /><input aria-label="Ticket code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="BCT-XXXX-XXXX-XXXX-XXXX" /><button onClick={() => void checkTicket(code)}>Check</button></label></section>
    <section className="gate-search"><header><Search size={18} /><span><strong>Find a guest or purchase</strong><small>Name, email, phone or payment reference</small></span></header><form onSubmit={(event) => { event.preventDefault(); void search(); }}><input aria-label="Find a guest or purchase" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search the door list" disabled={!online} /><button disabled={!online || searching || searchQuery.trim().length < 2}>{searching ? <Loader2 className="spin" size={14} /> : "Find"}</button></form>{matches.length ? <div>{matches.map((match) => <article key={match.ticketId}><span><b>{match.attendeeName ?? match.customerName ?? "Guest"}</b><small>{match.reference} · {match.ticketType?.replaceAll("-", " ")}</small><small>{match.customerEmail} · {match.customerPhone}</small></span><i className={match.status}>{match.status?.replaceAll("_", " ")}</i></article>)}</div> : null}</section>
    <DoorDesk key={eventSlug} eventSlug={eventSlug} />
    <footer className="scanner-stats"><span><Users size={17} /><b>{stats.checkedIn}</b> admitted</span><span><b>{Math.max(0, stats.issued - stats.checkedIn)}</b> remaining</span><span><b>{stats.issued}</b> active tickets</span><button type="button" disabled={syncing} onClick={() => { void loadEventState(); void syncQueue(); }}><RefreshCw size={14} /> Refresh</button>{stats.tiers.map((tier) => <span key={tier.ticketType}><b>{tier.checkedIn ?? 0}/{tier.issued}</b> {tier.ticketType.replaceAll("-", " ")}</span>)}</footer>
  </section></main>;
}
