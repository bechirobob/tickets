"use client";

import Link from "next/link";
import Image from "next/image";
import { eventImageUrl } from "../../event-images";
import { ArrowDown, ArrowLeft, BadgeCheck, Camera, ChevronDown, ConciergeBell, Flag, Gem, HandHelping, MessageCircle, MoreHorizontal, Music2, Reply, Send, ShieldCheck, UserRoundX, Users, Wine, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import TicketDialog from "../../ticket-dialog";
import { requestJson, requestErrorMessage, RequestError } from "../../../lib/client-request";
import FlashesPanel, { type RoomFlash } from "./flashes-panel";
import RoomNotifications from "./room-notifications";

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
  const [vipDetail, setVipDetail] = useState("");
  const [vipLocation, setVipLocation] = useState("");
  const [vipBusy, setVipBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const requestBusyRef = useRef(false);
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

  const connect = useCallback((attendeeId: string) => {
    if (leavingRef.current) return;
    const current = socketRef.current;
    if (current?.readyState === WebSocket.OPEN || current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/room/socket?event=${encodeURIComponent(slug)}`);
    socketRef.current = socket;
    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      lastSocketActivityRef.current = Date.now();
      setStatus("connected");
    };
    socket.onmessage = (event) => {
      lastSocketActivityRef.current = Date.now();
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
      if (payload.type === "snapshot") {
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
      if (socketRef.current === socket) socketRef.current = null;
      if (leavingRef.current) return;
      setStatus((currentStatus) => currentStatus === "denied" ? currentStatus : "offline");
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(15_000, 750 * (2 ** Math.min(attempt, 5))) + Math.floor(Math.random() * 300);
      reconnectTimerRef.current = window.setTimeout(() => connectRef.current(attendeeId), delay);
    };
    socket.onerror = () => {
      setStatus("offline");
      socket.close();
    };
  }, [slug]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    let cancelled = false;
    leavingRef.current = false;
    const controller = new AbortController();
    requestJson<{ allowed?: boolean; attendee?: { id: string; roomBadge?: "VIP" | null }; room?: Policy; error?: string }>(`/api/rooms/${encodeURIComponent(slug)}/access`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        if (!data.allowed || !data.attendee) {
          setNotice(data.error ?? "A verified ticket is required.");
          setStatus("denied");
          return;
        }
        attendeeIdRef.current = data.attendee.id;
        setSelfId(data.attendee.id);
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
      leavingRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "Leaving Room");
      socketRef.current = null;
    };
  }, [accessAttempt, connect, slug]);

  useEffect(() => {
    function reconnectIfNeeded() {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastSocketActivityRef.current <= 60_000) return;
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close(4000, "Refreshing connection");
      else if (attendeeIdRef.current) connectRef.current(attendeeIdRef.current);
    }
    function onVisibility() { if (document.visibilityState === "visible") reconnectIfNeeded(); }
    window.addEventListener("online", reconnectIfNeeded);
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
    if (requestBusyRef.current || !window.confirm(`Block ${displayName}? Their messages will be hidden in this Room.`)) return;
    requestBusyRef.current = true;
    try {
    await requestJson(`/api/rooms/${encodeURIComponent(slug)}/block`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendeeId }),
    });
      setMessages((current) => current.filter((message) => message.attendeeId !== attendeeId));
      setNotice(`${displayName} has been blocked.`);
    } catch (error) { setNotice(requestErrorMessage(error)); }
    finally { requestBusyRef.current = false; }
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
      setNotice(vipKind === "song_suggestion" ? "Your suggestion is with the Host. It is not a promise to play it." : "VIP concierge request sent privately to the Host.");
      setVipDetail(""); setVipLocation(""); setVipOpen(false);
      const data = await requestJson<{ requests?: VipRequest[] }>(`/api/rooms/${encodeURIComponent(slug)}/vip`);
      setVipRequests(data.requests ?? []);
    } catch (error) { setFormError(requestErrorMessage(error)); setNotice(requestErrorMessage(error)); }
    finally { requestBusyRef.current = false; setVipBusy(false); }
  }

  if (status === "loading" || (status === "connecting" && !policy)) {
    return <main className="room-gate"><MessageCircle /><p>Opening your verified attendee Room…</p></main>;
  }
  if (status === "denied") {
    return <main className="room-gate"><ShieldCheck /><h1>This Room is ticket-locked.</h1><p>{notice}</p><Link href="/tickets">Open your ticket wallet</Link></main>;
  }
  if (status === "offline" && !selfId) {
    return <main className="room-gate"><MessageCircle /><h1>Let’s reconnect.</h1><p>{notice}</p><button type="button" onClick={() => { setStatus("loading"); setNotice(""); setAccessAttempt((value) => value + 1); }}>Try again</button><Link href="/my-nights">Back to My Nights</Link></main>;
  }

  const pinned = messages.filter((message) => message.pinned && !message.deletedAt).slice(-1)[0];
  const vipEnabled = Boolean(vipSettings && (vipSettings.bottleServiceEnabled || vipSettings.songSuggestionsEnabled || vipSettings.assistanceEnabled));
  const timeline = [
    ...messages.map((message) => ({ type: "message" as const, createdAt: message.createdAt, value: message })),
    ...flashes.map((flash) => ({ type: "flash" as const, createdAt: flash.createdAt, value: flash })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return (
    <main className="room-page">
      <header className="room-header">
        <Link href="/my-nights" aria-label="Back to My Nights"><ArrowLeft size={17} /><span>My Nights</span></Link>
        <div className="room-header__identity"><Image src={eventImageUrl(eventImage, 120)} width={48} height={56} alt="" aria-hidden="true" unoptimized /><div><small>The Room</small><strong>{policy?.eventTitle ?? fallbackTitle}</strong><span>{fallbackDate}</span></div></div>
        <div className="room-header__activity"><span aria-label={`${online} people online`} title={`${online} people online`}><Users size={16} /><b>{online}</b></span><button type="button" className="room-flash-toggle" aria-label={`Open Flashes; ${flashCount} available`} title={`Flashes · ${flashCount}`} onClick={() => setGalleryOpen(true)} disabled={Boolean(policy?.readOnly)}><Camera size={17} /><b>{flashCount}</b></button><RoomNotifications slug={slug} onNotice={setNotice} /></div>
      </header>
      <section className="room-trust"><BadgeCheck size={16} /><b>Ticket holders only</b><span>{policy?.emergencyReadOnly ? "Host pause active" : policy?.slowModeSeconds ? `Slow mode · ${policy.slowModeSeconds}s` : "Your Night, together"}</span><i className={status === "connected" ? "live" : ""}>{status === "connected" ? "Live" : "Reconnecting…"}</i></section>
      {pinned && <details className="room-pinned" key={pinned.id}><summary><BadgeCheck size={16} /><b>Pinned by the Host</b><span>{pinned.content}</span><ChevronDown size={15} /></summary><p>{pinned.content}</p></details>}
      {notice && <div className="room-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16} /></button></div>}
      <section ref={streamRef} className="room-stream" aria-label="Room conversation" onScroll={(event) => { const stream = event.currentTarget; nearBottomRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80; if (nearBottomRef.current) setHasUnread(false); }}>
        {timeline.length === 0 && <div className="room-empty"><MessageCircle /><h2>You’re in.</h2><p>Someone has to say hello first. Your people are on their way.</p></div>}
        {timeline.map((item, index) => {
          if (item.type === "flash") {
            const flash = item.value;
            return <article key={`flash:${flash.id}`} className={`room-message room-flash-message ${flash.mine ? "own" : ""}`}>
              {!flash.mine && <div className="room-avatar" aria-hidden="true">{flash.displayName.slice(0, 1).toUpperCase()}</div>}
              <div className="room-flash-message__body">
                <span className="room-flash-message__meta"><b>{flash.mine ? "You" : flash.displayName}</b><time>{new Date(flash.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
                <button type="button" onClick={() => setSelectedFlashId(flash.id)} aria-label={`Open Flash from ${flash.mine ? "you" : flash.displayName}`}>
                  <span className="room-flash-message__closed"><Camera size={18} /><span><b>Flash</b><i>Tap to open</i></span></span>
                </button>
              </div>
            </article>;
          }
          const message = item.value;
          const parent = message.parentId ? messages.find((candidate) => candidate.id === message.parentId) : null;
          const own = message.attendeeId === selfId;
          const prior = timeline[index - 1];
          const sameDay = prior && new Date(prior.createdAt).toDateString() === new Date(message.createdAt).toDateString();
          const grouped = sameDay && prior?.type === "message" && prior.value.attendeeId === message.attendeeId && prior.value.kind === "message" && message.kind === "message" && !prior.value.deletedAt && !message.deletedAt && Date.parse(message.createdAt) - Date.parse(prior.createdAt) < 180_000;
          return <Fragment key={message.id}>{!sameDay && <p className="room-day"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</time></p>}<article className={`room-message ${own ? "own" : ""} ${grouped ? "grouped" : ""} ${message.kind === "announcement" ? "announcement" : ""}`} aria-label={`${own ? "You" : message.displayName}, ${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}>
            {!own && <div className="room-avatar" aria-hidden="true">{message.kind === "announcement" ? <BadgeCheck size={17} /> : message.displayName.slice(0, 1).toUpperCase()}</div>}
            <div className="room-message__body">
              <header><b>{message.kind === "announcement" ? "Host update" : own ? "You" : message.displayName}</b>{message.kind !== "announcement" && message.role !== "attendee" ? <span><BadgeCheck size={12} /> {message.role === "moderator" ? "Moderator" : "Host"}</span> : message.roomBadge === "VIP" ? <span className="room-vip-badge" aria-label="VIP ticket holder" title="VIP ticket holder"><Gem size={11} aria-hidden="true" /></span> : null}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header>
                {parent && <div className="room-reply-preview"><Reply size={12} /><b>{parent.attendeeId === selfId ? "You" : parent.displayName}</b><span>{parent.content.slice(0, 90)}</span></div>}
              <div className="room-bubble">
                <p className={message.deletedAt ? "removed" : ""}>{message.content}</p>
              </div>
              {!message.deletedAt && message.reactions.length > 0 && <div className="room-reaction-counts">{message.reactions.map((reaction) => <button key={reaction.emoji} type="button" aria-label={`${reaction.emoji}, ${reaction.count} reactions`} aria-pressed={reaction.mine} disabled={Boolean(policy?.readOnly) || status !== "connected"} onClick={() => react(message.id, reaction.emoji)}>{reaction.emoji}<span>{reaction.count}</span></button>)}</div>}
            </div>
            {!message.deletedAt && <button type="button" className="room-message-menu" aria-label={`Actions for ${own ? "your" : message.displayName + "'s"} message`} onClick={() => setActionMessage(message)}><MoreHorizontal size={18} /></button>}
          </article></Fragment>;
        })}
        {policy?.readOnly ? <div className="room-flashes-expired"><Camera size={16} /><span><b>The Flashes left with the night.</b> Chat kept the memories it could spell.</span></div> : null}
        <div ref={bottomRef} />
      </section>
      <p className="sr-only" role="status">{messages.length > 0 ? `${messages[messages.length - 1].displayName}: ${messages[messages.length - 1].content}` : ""}</p>
      {hasUnread && <button type="button" className="room-latest" onClick={jumpToLatest}><ArrowDown size={15} /> New messages</button>}
      <section className="room-composer">
        {replyingTo && <div><Reply size={13} /> Replying to <b>{replyingTo.displayName}</b><button onClick={() => setReplyingTo(null)}>Cancel</button></div>}
        {policy?.readOnly ? <p><ShieldCheck size={15} /> {policy.emergencyReadOnly ? "The Host paused messages. Updates still land here." : "The Room is read-only now. Even the best afterparty eventually gets lights-on."}</p> : <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          {selfRoomBadge === "VIP" && vipSettings ? <button type="button" className="room-concierge" onClick={() => { setFormError(""); setVipOpen(true); }} aria-label="Open VIP services" title="VIP services"><ConciergeBell size={18} /></button> : null}
          <button type="button" className="room-camera" onClick={() => setCaptureRequest((value) => value + 1)} aria-label="Share a Flash"><Camera size={18} /></button>
          <textarea ref={composerRef} aria-label="Message The Room" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} placeholder={status === "connected" ? "Message The Room" : "Reconnecting… your draft stays here"} rows={1} maxLength={500} />
          {draft.length > 450 && <span className="near-limit">{draft.length}/500</span>}<button aria-label="Send message" disabled={!draft.trim() || status !== "connected"}><Send size={18} /></button>
        </form>}
      </section>
      <FlashesPanel slug={slug} readOnly={Boolean(policy?.readOnly)} expiresAt={policy?.readOnlyAt ?? new Date().toISOString()} refreshKey={flashVersion} onCount={setFlashCount} onFlashes={setFlashes} galleryOpen={galleryOpen} onGalleryClose={() => setGalleryOpen(false)} selectedFlashId={selectedFlashId} onSelectedFlashClose={() => setSelectedFlashId(null)} captureRequest={captureRequest} />
      {vipOpen && vipSettings ? <TicketDialog className="room-vip-modal" label="VIP concierge" onClose={() => setVipOpen(false)}><section>
        <header><div><small>Connected to the Host</small><h2>VIP concierge</h2></div><button type="button" onClick={() => setVipOpen(false)} aria-label="Close VIP concierge"><X size={18} /></button></header>
        {formError && <p role="alert">{formError}</p>}
        {vipEnabled ? <><nav aria-label="VIP services">
          {vipSettings.bottleServiceEnabled ? <button type="button" className={vipKind === "bottle_service" ? "active" : ""} onClick={() => setVipKind("bottle_service")}><Wine size={15} /> Bottle service</button> : null}
          {vipSettings.songSuggestionsEnabled ? <button type="button" className={vipKind === "song_suggestion" ? "active" : ""} onClick={() => setVipKind("song_suggestion")}><Music2 size={15} /> Suggest a song</button> : null}
          {vipSettings.assistanceEnabled ? <button type="button" className={vipKind === "assistance" ? "active" : ""} onClick={() => setVipKind("assistance")}><HandHelping size={15} /> Assistance</button> : null}
        </nav>
        {vipKind === "bottle_service" && vipSettings.bottleMenu ? <p className="room-vip-menu">{vipSettings.bottleMenu}</p> : null}
        <label>{vipKind === "song_suggestion" ? "Song and artist" : vipKind === "bottle_service" ? "Bottle or package" : "What do you need?"}<textarea value={vipDetail} onChange={(event) => setVipDetail(event.target.value.slice(0, 500))} placeholder={vipKind === "song_suggestion" ? "Song — Artist" : vipKind === "bottle_service" ? "Choose from the Host menu above" : "Keep it short and specific"} /></label>
        {vipKind === "bottle_service" ? <label>Find me at<input value={vipLocation} onChange={(event) => setVipLocation(event.target.value.slice(0, 120))} placeholder="Table, section or nearby landmark" /></label> : null}
        {vipKind === "song_suggestion" ? <small>Make your case. Suggestions go privately to the Host or DJ, who decides what gets played.</small> : null}
        <button className="room-vip-send" type="button" disabled={vipBusy || !vipDetail.trim() || (vipKind === "bottle_service" && !vipLocation.trim())} onClick={() => void submitVipRequest()}>{vipBusy ? "Sending…" : "Send privately"}</button>
        </> : <div className="room-vip-unavailable"><ConciergeBell size={20} /><div><b>VIP services are not open yet.</b><p>The Host will open available services here when the team is ready. Good things take a minute.</p></div></div>}
        {vipRequests.length ? <details><summary>Recent requests · {vipRequests.length}</summary>{vipRequests.slice(0, 5).map((item) => <article key={item.id}><span><b>{item.kind.replaceAll("_", " ")}</b><small>{item.detail}</small></span><i>{item.status.replaceAll("_", " ")}</i></article>)}</details> : null}
      </section></TicketDialog> : null}
      {actionMessage && <TicketDialog className="room-modal room-actions-modal" label="Message actions" onClose={() => setActionMessage(null)}><section><header><b>{actionMessage.attendeeId === selfId ? "Your message" : actionMessage.displayName}</b><button aria-label="Close message actions" onClick={() => setActionMessage(null)}><X size={18} /></button></header><blockquote>{actionMessage.content}</blockquote><div className="room-action-reactions">{["🔥", "❤️", "😂", "👏", "👀"].map((emoji) => <button key={emoji} aria-label={`React ${emoji}`} disabled={Boolean(policy?.readOnly) || status !== "connected"} onClick={() => { react(actionMessage.id, emoji); setActionMessage(null); }}>{emoji}</button>)}</div><nav aria-label="Message actions"><button disabled={Boolean(policy?.readOnly)} onClick={() => { setReplyingTo(actionMessage); setActionMessage(null); window.setTimeout(() => composerRef.current?.focus(), 0); }}><Reply size={17} />Reply</button>{actionMessage.attendeeId !== selfId && actionMessage.role === "attendee" && <><button onClick={() => { setFormError(""); setReporting(actionMessage); setActionMessage(null); }}><Flag size={17} />Report privately</button><button onClick={() => { void block(actionMessage.attendeeId, actionMessage.displayName); setActionMessage(null); }}><UserRoundX size={17} />Block attendee</button></>}</nav></section></TicketDialog>}
      {reporting && <TicketDialog className="room-modal" label="Report a message privately" onClose={() => setReporting(null)}><section><Flag /><p className="eyebrow">Private report</p><h2>Tell the moderation team what happened.</h2>{formError && <p role="alert">{formError}</p>}<label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="unsafe">Unsafe behaviour</option><option value="other">Other</option></select></label><label>Details<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 500))} placeholder="Optional context for the moderator" /></label><div><button onClick={() => setReporting(null)}>Cancel</button><button disabled={reportBusy} onClick={submitReport}>{reportBusy ? "Sending…" : "Send report"}</button></div></section></TicketDialog>}
    </main>
  );
}
