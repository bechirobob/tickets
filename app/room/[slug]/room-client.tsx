"use client";

import Link from "next/link";
import Image from "next/image";
import { eventImageUrl } from "../../event-images";
import { ArrowDown, ArrowLeft, ArrowUp, BadgeCheck, Camera, ChevronDown, ConciergeBell, Flag, Gem, HandHelping, MessageCircle, Music2, Reply, ShieldCheck, Users, Wine, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import RoomOverlay from "../../room-overlay";
import { mountRoomViewport } from "../../../lib/room-viewport";
import { requestJson, requestErrorMessage, RequestError } from "../../../lib/client-request";
import FlashesPanel, { type RoomFlash } from "./flashes-panel";
import ConfirmationNotifications from "../../confirmation-notifications";
import RoomNotifications from "./room-notifications";
import MessageTools from "./message-tools";
import { FlashMarker, RoomComposeContent } from "../../room-chat-parts";

type Reaction = { emoji: string; count: number; mine: boolean };
type Message = {
  id: string; sequence: number; attendeeId: string; displayName: string; role: "attendee" | "organizer" | "moderator";
  roomBadge: "VIP" | null;
  kind: "message" | "announcement"; content: string; parentId: string | null; pinned: boolean;
  createdAt: string; deletedAt: string | null; reactions: Reaction[];
};
type Policy = { eventSlug: string; eventTitle: string; readOnlyAt: string; readOnly: boolean; emergencyReadOnly?: boolean; slowModeSeconds?: number; archived?: boolean };
type VipSettings = { bottleServiceEnabled: boolean; bottleMenu: string | null; songSuggestionsEnabled: boolean; assistanceEnabled: boolean };
type VipRequest = { id: string; kind: string; detail: string; location: string | null; status: string; organizerNote: string | null; createdAt: string };

// Draft text stays in this tab's memory and is restored only after access is
// checked for the same attendee and Room. It is never written to web storage.
const roomDrafts = new Map<string, string>();

export default function RoomClient({ slug, fallbackTitle, fallbackDate, eventImage }: { slug: string; fallbackTitle: string; fallbackDate: string; eventImage: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [selfId, setSelfId] = useState("");
  const [selfRoomBadge, setSelfRoomBadge] = useState<"VIP" | null>(null);
  const [online, setOnline] = useState(0);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [status, setStatus] = useState<"loading" | "connecting" | "connected" | "denied" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const [blocking, setBlocking] = useState<{ id: string; name: string } | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [vipSent, setVipSent] = useState("");
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [flashVersion, setFlashVersion] = useState(0);
  const [flashCount, setFlashCount] = useState(0);
  const [flashes, setFlashes] = useState<RoomFlash[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selectedFlashId, setSelectedFlashId] = useState<string | null>(null);
  const [captureRequest, setCaptureRequest] = useState(0);
  const [vipSettings, setVipSettings] = useState<VipSettings | null>(null);
  const [vipRequests, setVipRequests] = useState<VipRequest[]>([]);
  const [vipOpen, setVipOpen] = useState(false);
  const [vipKind, setVipKind] = useState<"bottle_service" | "song_suggestion" | "assistance">("bottle_service");
  const [vipDrafts, setVipDrafts] = useState<Record<string, { detail: string; location: string }>>({});
  const vipDetail = vipDrafts[vipKind]?.detail ?? "";
  const vipLocation = vipDrafts[vipKind]?.location ?? "";
  function setVipDetail(detail: string) { setVipDrafts(current => ({ ...current, [vipKind]: { detail, location: current[vipKind]?.location ?? "" } })); }
  function setVipLocation(location: string) { setVipDrafts(current => ({ ...current, [vipKind]: { detail: current[vipKind]?.detail ?? "", location } })); }
  const [vipBusy, setVipBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [hasUnread, setHasUnread] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const requestBusyRef = useRef(false);
  const roomRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<HTMLElement | null>(null);
  const nearBottomRef = useRef(true);
  const itemCountRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(attendeeId: string) => void>(() => undefined);
  const attendeeIdRef = useRef("");
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const leavingRef = useRef(false);
  const lastSocketActivityRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const updateSnapshotRef = useRef<string | null>(null);
  const roomSnapshotReadyRef = useRef(false);
  const updateAcknowledgmentRequestRef = useRef<AbortController | null>(null);
  const updateAcknowledgmentRetryRef = useRef<{ snapshot: string | null; attempts: number; timer: number | null }>({ snapshot: null, attempts: 0, timer: null });
  const updateSnapshotRecoveryRef = useRef(false);

  const cancelUpdateAcknowledgment = useCallback(() => {
    const retry = updateAcknowledgmentRetryRef.current;
    if (retry.timer !== null) window.clearTimeout(retry.timer);
    retry.timer = null;
    updateAcknowledgmentRequestRef.current?.abort();
    updateAcknowledgmentRequestRef.current = null;
  }, []);

  const acknowledgeVisibleUpdates = useCallback(async function acknowledge() {
    const snapshot = updateSnapshotRef.current;
    if (!snapshot || !roomSnapshotReadyRef.current || updateAcknowledgmentRequestRef.current || leavingRef.current
      || socketRef.current?.readyState !== WebSocket.OPEN || document.visibilityState !== 'visible') return;
    const retry = updateAcknowledgmentRetryRef.current;
    if (retry.snapshot !== snapshot) {
      if (retry.timer !== null) window.clearTimeout(retry.timer);
      retry.snapshot = snapshot; retry.attempts = 0; retry.timer = null;
    }
    if (retry.timer !== null || retry.attempts >= 4) return;
    retry.attempts++;
    const controller = new AbortController();
    updateAcknowledgmentRequestRef.current = controller;
    try {
      await requestJson(`/api/rooms/${encodeURIComponent(slug)}/updates/read`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }), signal: controller.signal,
      });
      if (controller.signal.aborted || leavingRef.current) return;
      if (updateSnapshotRef.current === snapshot) updateSnapshotRef.current = null;
      updateSnapshotRecoveryRef.current = false;
      window.dispatchEvent(new Event('bct:room-updates-read'));
    } catch (error) {
      if (controller.signal.aborted || leavingRef.current || updateSnapshotRef.current !== snapshot) return;
      // An expired cursor cannot be replaced against an old rendered snapshot.
      // Re-authorize and receive a fresh Room snapshot before acknowledging its
      // new boundary. Only one automatic recovery is allowed per failed cycle.
      if (error instanceof RequestError && error.status === 400 && !updateSnapshotRecoveryRef.current && updateSnapshotRef.current === snapshot) {
        updateSnapshotRecoveryRef.current = true;
        roomSnapshotReadyRef.current = false;
        updateSnapshotRef.current = null;
        setAccessAttempt(value => value + 1);
      }
      // Retry only transient failures, at most three times for this same viewed
      // boundary. Never capture newer arrivals merely to clear the old badge.
      const transient = error instanceof RequestError && (error.status === null || error.status === 408 || error.status === 429 || error.status >= 500);
      if (!transient) retry.attempts = 4;
      if (transient && retry.attempts < 4 && document.visibilityState === 'visible' && roomSnapshotReadyRef.current) {
        const delay = 1_000 * 2 ** (retry.attempts - 1);
        retry.timer = window.setTimeout(() => { retry.timer = null; void acknowledge(); }, delay);
      }
    }
    finally { if (updateAcknowledgmentRequestRef.current === controller) updateAcknowledgmentRequestRef.current = null; }
  }, [slug]);

  useEffect(() => cancelUpdateAcknowledgment, [cancelUpdateAcknowledgment, slug]);

  const openedAnnouncement = useRef('');
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('announcement');
    if (!requested || openedAnnouncement.current === requested) return;
    const target = [...(roomRef.current?.querySelectorAll<HTMLElement>('[data-announcement]') ?? [])].find(element => element.dataset.announcement === requested);
    if (target) {
      nearBottomRef.current = false;
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({block:'center'});
      openedAnnouncement.current = requested;
    }
  }, [messages]);

  const connect = useCallback((attendeeId: string) => {
    if (leavingRef.current) return;
    const current = socketRef.current;
    if (current?.readyState === WebSocket.OPEN || current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    roomSnapshotReadyRef.current = false;
    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const announcement = new URLSearchParams(window.location.search).get('announcement') ?? '';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/room/socket?event=${encodeURIComponent(slug)}&announcement=${encodeURIComponent(announcement.slice(0,80))}`);
    socketRef.current = socket;
    socket.onopen = () => {
      if (socketRef.current !== socket || leavingRef.current) return;
      reconnectAttemptRef.current = 0;
      lastSocketActivityRef.current = Date.now();
      setStatus("connected");
    };
    socket.onmessage = (event) => {
      if (socketRef.current !== socket || leavingRef.current) return;
      lastSocketActivityRef.current = Date.now();
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
      if (payload.type === "snapshot") {
        roomSnapshotReadyRef.current = true;
        setMessages(payload.messages as Message[]);
        setPolicy(payload.room as Policy);
        setOnline(Number(payload.online) || 0);
      } else if (payload.type === "message") {
        const message = payload.message as Message;
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      } else if (payload.type === "presence") {
        setOnline(Number(payload.online) || 0);
      } else if (payload.type === "reaction") {
        const messageId = String(payload.messageId);
        const emoji = String(payload.emoji);
        const count = Number(payload.count) || 0;
        const mine = String(payload.attendeeId) === attendeeId ? Boolean(payload.active) : undefined;
        setMessages((current) => current.map((message) => {
          if (message.id !== messageId) return message;
          const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
          const reactions = count === 0
            ? message.reactions.filter((reaction) => reaction.emoji !== emoji)
            : existing
              ? message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count, mine: mine ?? reaction.mine } : reaction)
              : [...message.reactions, { emoji, count, mine: mine ?? false }];
          return { ...message, reactions };
        }));
      } else if (payload.type === "message_removed") {
        setMessages((current) => current.map((message) => message.id === payload.messageId ? { ...message, content: "Message removed", deletedAt: new Date().toISOString() } : message));
      } else if (payload.type === "flash_added" || payload.type === "flash_removed") {
        setFlashVersion((current) => current + 1);
      } else if (payload.type === "room_closed") {
        setPolicy((current) => current ? { ...current, readOnly: true } : current);
        setFlashCount(0);
        setFlashes([]);
      } else if (payload.type === "policy") {
        setPolicy(payload.room as Policy);
      } else if (payload.type === "pins_cleared") {
        setMessages((current) => current.map((message) => ({ ...message, pinned: false })));
      } else if (payload.type === "error") {
        setNotice(String(payload.error ?? "The Room could not complete that action."));
      }
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (leavingRef.current) return;
      setStatus((currentStatus) => currentStatus === "denied" ? currentStatus : "offline");
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(15_000, 750 * (2 ** Math.min(attempt, 5))) + Math.floor(Math.random() * 300);
      reconnectTimerRef.current = window.setTimeout(() => connectRef.current(attendeeId), delay);
    };
    socket.onerror = () => {
      if (socketRef.current !== socket || leavingRef.current) return;
      setStatus("offline");
      socket.close();
    };
  }, [slug]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    let cancelled = false;
    leavingRef.current = false;
    const controller = new AbortController();
    roomSnapshotReadyRef.current = false;
    updateSnapshotRef.current = null;
    requestJson<{ allowed?: boolean; attendee?: { id: string; roomBadge?: "VIP" | null }; room?: Policy; updateSnapshot?: string | null; error?: string }>(`/api/rooms/${encodeURIComponent(slug)}/access`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        if (!data.allowed || !data.attendee) {
          setNotice(data.error ?? "Open your ticket to join the Room.");
          for (const key of roomDrafts.keys()) if (key.endsWith(`:${slug}`)) roomDrafts.delete(key);
          setDraft("");
          setStatus("denied");
          return;
        }
        attendeeIdRef.current = data.attendee.id;
        updateSnapshotRef.current = data.updateSnapshot ?? null;
        setSelfId(data.attendee.id);
        setDraft(roomDrafts.get(`${data.attendee.id}:${slug}`) ?? "");
        setSelfRoomBadge(data.attendee.roomBadge ?? null);
        setPolicy(data.room ?? null);
        if (data.attendee.roomBadge === "VIP") {
          void requestJson<{ settings?: VipSettings; requests?: VipRequest[] }>(`/api/rooms/${encodeURIComponent(slug)}/vip`, { signal: controller.signal }).then((vip) => {
            if (!cancelled) {
              const configuration = vip.settings ?? null;
              setVipSettings(configuration);
              setVipRequests(vip.requests ?? []);
              if (configuration && !configuration.bottleServiceEnabled) setVipKind(configuration.songSuggestionsEnabled ? "song_suggestion" : "assistance");
            }
          }).catch((error) => { if (!cancelled) setNotice(requestErrorMessage(error)); });
        }
        connect(data.attendee.id);
      })
      .catch((error) => { if (!cancelled) { setNotice(requestErrorMessage(error)); setStatus(error instanceof RequestError && (error.status === 401 || error.status === 403) ? "denied" : "offline"); } });
    return () => {
      cancelled = true;
      controller.abort();
      cancelUpdateAcknowledgment();
      leavingRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "Leaving Room");
      socketRef.current = null;
    };
  }, [accessAttempt, cancelUpdateAcknowledgment, connect, slug]);

  useEffect(() => {
    // Effects run after the actual Room snapshot has rendered. Neither prefetch,
    // a homepage count request, a failed connection nor a hidden tab reads it.
    if (status === 'connected') void acknowledgeVisibleUpdates();
    else cancelUpdateAcknowledgment();
    const visible = () => {
      if (document.visibilityState !== 'visible') cancelUpdateAcknowledgment();
      else if (status === 'connected') void acknowledgeVisibleUpdates();
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [acknowledgeVisibleUpdates, cancelUpdateAcknowledgment, messages, status]);

  useEffect(() => {
    function reconnectIfNeeded() {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastSocketActivityRef.current <= 60_000) return;
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close(4000, "Refreshing connection");
      else if (attendeeIdRef.current) connectRef.current(attendeeIdRef.current);
      else setAccessAttempt(value => value + 1);
    }
    function onVisibility() { if (document.visibilityState === "visible") reconnectIfNeeded(); }
    window.addEventListener("online", reconnectIfNeeded);
    window.addEventListener("focus", reconnectIfNeeded);
    window.addEventListener("pageshow", reconnectIfNeeded);
    document.addEventListener("visibilitychange", onVisibility);
    const heartbeat = window.setInterval(() => {
      const socket = socketRef.current;
      if (document.visibilityState !== "visible" || !socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        if (Date.now() - lastSocketActivityRef.current > 60_000) socket.close(4000, "Heartbeat missed");
        else socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);
    return () => {
      window.removeEventListener("online", reconnectIfNeeded);
      window.removeEventListener("focus", reconnectIfNeeded);
      window.removeEventListener("pageshow", reconnectIfNeeded);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
    };
  }, []);

  useEffect(() => {
    const nextCount = messages.length + flashes.length;
    const added = nextCount > itemCountRef.current;
    itemCountRef.current = nextCount;
    if (nearBottomRef.current) {
      const stream = streamRef.current;
      if (stream) stream.scrollTop = stream.scrollHeight;
    } else if (added) setHasUnread(true);
  }, [flashes.length, messages.length]);

  useEffect(() => {
    const input = composerRef.current;
    if (input) { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 112)}px`; }
  }, [draft]);

  useEffect(() => mountRoomViewport((height) => {
    roomRef.current?.style.setProperty("--room-height", `${height}px`);
    if (nearBottomRef.current && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }), [status]);

  function jumpToLatest() {
    nearBottomRef.current = true;
    setHasUnread(false);
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  useEffect(() => {
    if (!policy || policy.readOnly) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= Date.parse(policy.readOnlyAt)) {
        setPolicy((current) => current ? { ...current, readOnly: true } : current);
        setFlashCount(0);
        setFlashes([]);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [policy]);

  function sendMessage() {
    const content = draft.trim();
    if (!content || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "message", content, parentId: replyingTo?.id ?? null }));
    nearBottomRef.current = true;
    setHasUnread(false);
    roomDrafts.delete(`${selfId}:${slug}`);
    setDraft("");
    setReplyingTo(null);
  }

  function react(messageId: string, emoji: string) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "reaction", messageId, emoji }));
    }
  }

  async function submitReport() {
    if (!reporting || requestBusyRef.current) return;
    requestBusyRef.current = true;
    setReportBusy(true);
    setFormError("");
    try {
    await requestJson(`/api/rooms/${encodeURIComponent(slug)}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: reporting.id, reason: reportReason, details: reportDetails }),
    });
    setNotice("Report sent privately to the moderation team.");
    setReporting(null); setReportDetails("");
    } catch (error) { setFormError(requestErrorMessage(error)); }
    finally { requestBusyRef.current = false; setReportBusy(false); }
  }

  async function block(attendeeId: string, displayName: string) {
    if (requestBusyRef.current) return;
    requestBusyRef.current = true; setBlockBusy(true); setFormError("");
    try {
    await requestJson(`/api/rooms/${encodeURIComponent(slug)}/block`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendeeId }),
    });
      setMessages((current) => current.filter((message) => message.attendeeId !== attendeeId));
      setNotice(`${displayName} has been blocked.`); setBlocking(null); setFlashVersion((value) => value + 1);
    } catch (error) { setFormError(requestErrorMessage(error)); }
    finally { requestBusyRef.current = false; setBlockBusy(false); }
  }

  async function submitVipRequest() {
    if (requestBusyRef.current || !vipDetail.trim() || (vipKind === "bottle_service" && !vipLocation.trim())) return;
    requestBusyRef.current = true;
    setVipBusy(true);
    setFormError("");
    try {
    await requestJson(`/api/rooms/${encodeURIComponent(slug)}/vip`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: vipKind, detail: vipDetail, location: vipLocation }),
    });
      setVipSent(vipKind === "song_suggestion" ? "Your song suggestion is with the DJ." : "The host has your request.");
      setVipDetail(""); setVipLocation("");
      // A successful request stays successful if refreshing its history fails.
      void requestJson<{ requests?: VipRequest[] }>(`/api/rooms/${encodeURIComponent(slug)}/vip`)
        .then((data) => setVipRequests(data.requests ?? []))
        .catch(() => undefined);
    } catch (error) { setFormError(requestErrorMessage(error)); }
    finally { requestBusyRef.current = false; setVipBusy(false); }
  }

  if (status === "loading" || (status === "connecting" && !policy)) {
    return <main className="room-gate"><MessageCircle aria-hidden="true" /><p>Finding your people…</p></main>;
  }
  if (status === "denied") {
    return <main className="room-gate"><ShieldCheck aria-hidden="true" /><h1>This Room is ticket-locked.</h1><p>{notice}</p><button type="button" onClick={() => { setStatus("loading"); setNotice(""); setAccessAttempt(value => value + 1); }}>Check access again</button><Link href="/my-nights?recover=1">Open your passes securely</Link></main>;
  }
  if (status === "offline" && !selfId) {
    return <main className="room-gate"><MessageCircle aria-hidden="true" /><h1>Let’s reconnect.</h1><p>{notice}</p><button type="button" onClick={() => { setStatus("loading"); setNotice(""); setAccessAttempt((value) => value + 1); }}>Try again</button><Link href="/my-nights">Back to My Nights</Link></main>;
  }

  const pinned = messages.filter((message) => message.pinned && !message.deletedAt).slice(-1)[0];
  const vipEnabled = Boolean(vipSettings && (vipSettings.bottleServiceEnabled || vipSettings.songSuggestionsEnabled || vipSettings.assistanceEnabled));
  const timeline = [
    ...messages.filter((message) => message.id !== pinned?.id).map((message) => ({ type: "message" as const, createdAt: message.createdAt, value: message })),
    ...flashes.map((flash) => ({ type: "flash" as const, createdAt: flash.createdAt, value: flash })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return (
    <main ref={roomRef} className="room-page">
      <header className="room-header">
        <Link href="/my-nights" aria-label="Back to My Nights"><ArrowLeft aria-hidden="true" size={17} /><span>My Nights</span></Link>
        <div className="room-header__identity"><Image src={eventImageUrl(eventImage, 120)} width={48} height={56} alt="" aria-hidden="true" unoptimized /><div><small>The Room</small><strong>{policy?.eventTitle ?? fallbackTitle}</strong><span>{fallbackDate}</span></div></div>
        <div className="room-header__activity"><span aria-label={`${online} people online`} title={`${online} people online`}><Users aria-hidden="true" size={16} /><b>{online}</b></span><button type="button" className="room-flash-toggle" aria-label={`Open Flashes; ${flashCount} unopened`} title={`Flashes · ${flashCount}`} onClick={() => setGalleryOpen(true)} disabled={Boolean(policy?.readOnly)}><Camera aria-hidden="true" size={17} /><b>{flashCount}</b></button><RoomNotifications slug={slug} onNotice={setNotice} /></div>
      </header>
      <section className="room-trust"><BadgeCheck aria-hidden="true" size={16} /><b>Ticket holders only</b><span>{policy?.emergencyReadOnly ? "Host pause active" : policy?.slowModeSeconds ? `Slow mode · ${policy.slowModeSeconds}s` : "Your Night, together"}</span><i className={status === "connected" ? "live" : ""}>{status === "connected" ? "Live" : "Reconnecting…"}</i></section>
      {selfId ? <ConfirmationNotifications compact onEnabled={() => setNotice("Event alerts are on. Booking confirmations and host announcements can reach this device.")} /> : null}
      {pinned && <details className="room-pinned" data-announcement={pinned.id} key={pinned.id}><summary><BadgeCheck aria-hidden="true" size={16} /><b>Host</b><span>{pinned.content}</span><ChevronDown aria-hidden="true" size={15} /></summary><p>{pinned.content}</p></details>}
      {notice && <div className="room-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X aria-hidden="true" size={16} /></button></div>}
      <section ref={streamRef} className="room-stream" aria-label="Room conversation" onScroll={(event) => { const stream = event.currentTarget; nearBottomRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80; if (nearBottomRef.current) setHasUnread(false); }}>
        {timeline.length === 0 && <div className="room-empty"><MessageCircle aria-hidden="true" /><h2>You’re in.</h2><p>Someone has to say hello first. Your people are on their way.</p></div>}
        {timeline.map((item, index) => {
          if (item.type === "flash") {
            const flash = item.value;
            return <article key={`flash:${flash.id}`} className={`room-message room-flash-message ${flash.mine ? "own" : ""}`}>
              {!flash.mine && <div className="room-avatar" aria-hidden="true">{flash.displayName.slice(0, 1).toUpperCase()}</div>}
              <div className="room-flash-message__body">
                <span className="room-flash-message__meta"><b>{flash.mine ? "You" : flash.displayName}</b><time>{new Date(flash.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
                <button type="button" disabled={Boolean(flash.openedAt) && !flash.mine} onClick={() => setSelectedFlashId(flash.id)} aria-label={`${flash.openedAt && !flash.mine ? "Opened" : "Open"} Flash from ${flash.mine ? "you" : flash.displayName}`}>
                  <FlashMarker opened={Boolean(flash.openedAt)} mine={flash.mine} />
                </button>
              </div>
            </article>;
          }
          const message = item.value;
          const announcement = message.kind === "announcement";
          const host = announcement || message.role === "organizer";
          const name = announcement ? "Host" : message.attendeeId === selfId ? "You" : message.displayName;
          const parent = message.parentId ? messages.find((candidate) => candidate.id === message.parentId) : null;
          const own = message.attendeeId === selfId;
          const prior = timeline[index - 1];
          const sameDay = prior && new Date(prior.createdAt).toDateString() === new Date(message.createdAt).toDateString();
          const grouped = sameDay && prior?.type === "message" && prior.value.attendeeId === message.attendeeId && prior.value.kind === "message" && message.kind === "message" && !prior.value.deletedAt && !message.deletedAt && Date.parse(message.createdAt) - Date.parse(prior.createdAt) < 180_000;
          return <Fragment key={message.id}>{!sameDay && <p className="room-day"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</time></p>}<article className={`room-message ${own ? "own" : ""} ${grouped ? "grouped" : ""} ${host ? "room-message--host" : ""}`} data-announcement={announcement ? message.id : undefined} aria-label={`${name}, ${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}>
            {!own && <div className="room-avatar" aria-hidden="true">{announcement ? "H" : message.displayName.slice(0, 1).toUpperCase()}</div>}
            <div className="room-message__body">
              <header><b>{name}</b>{host ? <span className="room-host-badge" role="img" aria-label="Event host" title="Event host"><BadgeCheck aria-hidden="true" size={12} />{!announcement && "Host"}</span> : message.role === "moderator" ? <span><BadgeCheck aria-hidden="true" size={12} /> Moderator</span> : message.roomBadge === "VIP" ? <span className="room-vip-badge" role="img" aria-label="VIP ticket holder" title="VIP ticket holder"><Gem size={11} aria-hidden="true" /></span> : null}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header>
                {parent && <div className="room-reply-preview"><Reply aria-hidden="true" size={12} /><b>{parent.attendeeId === selfId ? "You" : parent.displayName}</b><span>{parent.content.slice(0, 90)}</span></div>}
              {announcement ? <div className="room-bubble"><p className={message.deletedAt ? "removed" : ""}>{message.content}</p></div> : <MessageTools content={message.content} name={message.displayName} own={own} disabled={Boolean(policy?.readOnly) || status !== "connected"} removed={Boolean(message.deletedAt)} reactions={message.reactions}
                onReact={(emoji) => react(message.id, emoji)}
                onReply={() => { setReplyingTo(message); window.requestAnimationFrame(() => composerRef.current?.focus()); }}
                onReport={!own && message.role === "attendee" ? () => { setFormError(""); setReporting(message); } : undefined}
                onBlock={!own && message.role === "attendee" ? () => { setFormError(""); setBlocking({ id: message.attendeeId, name: message.displayName }); } : undefined}>
                <p className={message.deletedAt ? "removed" : ""}>{message.content}</p>
              </MessageTools>}
            </div>
          </article></Fragment>;
        })}
        {policy?.readOnly ? <div className="room-flashes-expired"><Camera aria-hidden="true" size={16} /><span><b>The Flashes left with the night.</b> Chat kept the memories it could spell.</span></div> : null}
        <div ref={bottomRef} />
      </section>
      <p className="sr-only" role="status">{messages.length > 0 ? `${messages[messages.length - 1].displayName}: ${messages[messages.length - 1].content}` : ""}</p>
      {hasUnread && <button type="button" className="room-latest" onClick={jumpToLatest}><ArrowDown aria-hidden="true" size={15} /> New messages</button>}
      <section className="room-composer">
        {replyingTo && <div className="chat-compose-reply"><Reply aria-hidden="true" size={15} /><span><b>Replying to {replyingTo.displayName}</b><small>{replyingTo.content}</small></span><button type="button" aria-label="Cancel reply" onClick={() => { setReplyingTo(null); composerRef.current?.focus(); }}><X aria-hidden="true" size={17} /></button></div>}
        {policy?.readOnly ? <p><ShieldCheck aria-hidden="true" size={15} /> {policy.emergencyReadOnly ? "The Host paused messages. Updates still land here." : "The Room is read-only now. Even the best afterparty eventually gets lights-on."}</p> : <form className="chat-compose-bar" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <RoomComposeContent accessory={<>
            {selfRoomBadge === "VIP" && vipSettings ? <button type="button" className="room-concierge" onClick={() => { setFormError(""); setVipSent(""); setVipOpen(true); }} aria-label="Open VIP services" title="VIP services"><ConciergeBell aria-hidden="true" size={19} /></button> : null}
            <button type="button" className="room-camera" onClick={() => setCaptureRequest((value) => value + 1)} aria-label="Share a Flash"><Camera aria-hidden="true" size={21} /></button>
          </>} field={<textarea ref={composerRef} aria-label="Message The Room" value={draft} onChange={(event) => {
            const value = event.target.value.slice(0, 500); setDraft(value);
            if (selfId) { const key = `${selfId}:${slug}`; roomDrafts.delete(key); if (value) roomDrafts.set(key, value); while (roomDrafts.size > 10) roomDrafts.delete(roomDrafts.keys().next().value!); }
          }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(hover: hover) and (pointer: fine)").matches) { event.preventDefault(); sendMessage(); } }} placeholder={status === "connected" ? "Message The Room" : "Reconnecting…"} rows={1} maxLength={500} />}
          detail={draft.length > 450 ? <span className="near-limit">{draft.length}/500</span> : null}
          send={<button className="chat-send" aria-label="Send message" disabled={!draft.trim() || status !== "connected"}><ArrowUp aria-hidden="true" size={20} /></button>} />
        </form>}
      </section>
      <FlashesPanel slug={slug} readOnly={Boolean(policy?.readOnly)} expiresAt={policy?.readOnlyAt ?? new Date().toISOString()} refreshKey={flashVersion} onCount={setFlashCount} onFlashes={setFlashes} galleryOpen={galleryOpen} onGalleryClose={() => setGalleryOpen(false)} selectedFlashId={selectedFlashId} onSelectedFlashClose={() => setSelectedFlashId(null)} captureRequest={captureRequest} />
      {vipOpen && vipSettings ? <RoomOverlay className="room-overlay--sheet" label="VIP concierge" busy={vipBusy} onClose={() => setVipOpen(false)}>{(dismiss) => <section className="room-sheet room-concierge-sheet">
        <header className="room-sheet__header"><div><span className="room-surface-kicker"><ConciergeBell aria-hidden="true" size={19} /> VIP concierge</span><h2>Need something?</h2></div><button type="button" onClick={dismiss} disabled={vipBusy} aria-label="Close VIP concierge"><X aria-hidden="true" size={20} /></button></header>
        {formError && <p role="alert" className="room-surface-error">{formError}</p>}
        {vipSent ? <div className="room-concierge-sent" role="status"><BadgeCheck aria-hidden="true" size={30} /><h3>You’re on their radar.</h3><p>{vipSent}</p><button type="button" onClick={() => setVipSent("")}>Anything else?</button></div> : vipEnabled ? <><nav className="room-services" aria-label="VIP services">
          {vipSettings.bottleServiceEnabled ? <button type="button" aria-pressed={vipKind === "bottle_service"} disabled={vipBusy} onClick={() => setVipKind("bottle_service")}><Wine aria-hidden="true" size={21} /><span><b>Bottle service</b></span><ArrowUp aria-hidden="true" size={15} /></button> : null}
          {vipSettings.songSuggestionsEnabled ? <button type="button" aria-pressed={vipKind === "song_suggestion"} disabled={vipBusy} onClick={() => setVipKind("song_suggestion")}><Music2 aria-hidden="true" size={21} /><span><b>Suggest a song</b></span><ArrowUp aria-hidden="true" size={15} /></button> : null}
          {vipSettings.assistanceEnabled ? <button type="button" aria-pressed={vipKind === "assistance"} disabled={vipBusy} onClick={() => setVipKind("assistance")}><HandHelping aria-hidden="true" size={21} /><span><b>A little help</b></span><ArrowUp aria-hidden="true" size={15} /></button> : null}
        </nav>
        <form className="room-service-form" onSubmit={(event) => { event.preventDefault(); void submitVipRequest(); }}>
        {vipKind === "bottle_service" && vipSettings.bottleMenu ? <details className="room-service-menu"><summary>Tonight’s bottle menu <ChevronDown aria-hidden="true" size={14} /></summary><p>{vipSettings.bottleMenu}</p></details> : null}
        <label>{vipKind === "song_suggestion" ? "Song and artist" : vipKind === "bottle_service" ? "Bottle or package" : "What do you need?"}<textarea disabled={vipBusy} value={vipDetail} onChange={(event) => setVipDetail(event.target.value.slice(0, 500))} placeholder={vipKind === "song_suggestion" ? "The track that would make your night" : vipKind === "bottle_service" ? "Your order, including how many" : "Tell the Host what’s up"} /></label>
        {vipKind === "bottle_service" ? <label>Find me at<input disabled={vipBusy} value={vipLocation} onChange={(event) => setVipLocation(event.target.value.slice(0, 120))} placeholder="Your table, section or nearby landmark" /></label> : null}
        {vipKind === "song_suggestion" ? <small>Suggestions go privately to the Host or DJ. They still call the set.</small> : null}
        <button className="room-surface-send" disabled={vipBusy || !vipDetail.trim() || (vipKind === "bottle_service" && !vipLocation.trim())}>{vipBusy ? "Sending…" : "Send privately"}<ArrowUp aria-hidden="true" size={18} /></button>
        </form></> : <div className="room-surface-empty"><ConciergeBell aria-hidden="true" size={26} /><h3>The concierge isn’t open yet.</h3><p>The Host will open services here when the team is ready.</p></div>}
        {vipRequests.length ? <details className="room-service-history"><summary>Your requests · {vipRequests.length}<ChevronDown aria-hidden="true" size={14} /></summary>{vipRequests.slice(0, 5).map((item) => <article key={item.id}><span><b>{item.kind.replaceAll("_", " ")}</b><small>{item.detail}</small>{item.organizerNote && <p>Host: {item.organizerNote}</p>}</span><i>{item.status.replaceAll("_", " ")}</i></article>)}</details> : null}
      </section>}</RoomOverlay> : null}

      {reporting && <RoomOverlay className="room-overlay--sheet" label="Report a message privately" busy={reportBusy} onClose={() => setReporting(null)}>{(dismiss) => <section className="room-sheet"><header className="room-sheet__header"><div><span className="room-surface-kicker"><Flag aria-hidden="true" size={16} /> Private report</span><h2>Tell us what happened.</h2></div><button type="button" aria-label="Close report" onClick={dismiss} disabled={reportBusy}><X aria-hidden="true" size={20} /></button></header>{formError && <p role="alert" className="room-surface-error">{formError}</p>}<label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="unsafe">Unsafe behaviour</option><option value="other">Other</option></select></label><label>Details<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 500))} placeholder="Anything the moderation team should know?" /></label><div className="room-surface-actions"><button type="button" onClick={dismiss} disabled={reportBusy}>Cancel</button><button className="room-surface-send" disabled={reportBusy} onClick={submitReport}>{reportBusy ? "Sending…" : "Send report"}</button></div></section>}</RoomOverlay>}
      {blocking && <RoomOverlay className="room-overlay--sheet" label={`Block ${blocking.name}`} busy={blockBusy} onClose={() => setBlocking(null)}>{(dismiss) => <section className="room-sheet"><h2>Block {blocking.name}?</h2><p>Their messages and Flashes will be hidden from you in this Room.</p>{formError && <p role="alert">{formError}</p>}<div className="room-surface-actions"><button type="button" disabled={blockBusy} onClick={dismiss}>Cancel</button><button type="button" className="room-surface-send" disabled={blockBusy} onClick={() => void block(blocking.id, blocking.name)}>{blockBusy ? "Blocking…" : "Block"}</button></div></section>}</RoomOverlay>}

    </main>
  );
}
