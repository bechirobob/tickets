"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, Camera, Flag, MessageCircle, Reply, Send, ShieldCheck, UserRoundX, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import FlashesPanel from "./flashes-panel";

type Reaction = { emoji: string; count: number; mine: boolean };
type Message = {
  id: string; sequence: number; attendeeId: string; displayName: string; role: "attendee" | "organizer" | "moderator";
  kind: "message" | "announcement"; content: string; parentId: string | null; pinned: boolean;
  createdAt: string; deletedAt: string | null; reactions: Reaction[];
};
type Policy = { eventSlug: string; eventTitle: string; readOnlyAt: string; readOnly: boolean };

export default function RoomClient({ slug, fallbackTitle, fallbackDate }: { slug: string; fallbackTitle: string; fallbackDate: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [selfId, setSelfId] = useState("");
  const [online, setOnline] = useState(0);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [status, setStatus] = useState<"loading" | "connecting" | "connected" | "denied" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [mode, setMode] = useState<"chat" | "flashes">("chat");
  const [flashVersion, setFlashVersion] = useState(0);
  const [flashCount, setFlashCount] = useState(0);
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
    fetch(`/api/rooms/${encodeURIComponent(slug)}/access`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { allowed?: boolean; attendee?: { id: string }; room?: Policy; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok || !data.allowed || !data.attendee) {
          setNotice(data.error ?? "A verified ticket is required.");
          setStatus("denied");
          return;
        }
        attendeeIdRef.current = data.attendee.id;
        setSelfId(data.attendee.id);
        setPolicy(data.room ?? null);
        connect(data.attendee.id);
      })
      .catch(() => { setNotice("The Room is temporarily unavailable."); setStatus("offline"); });
    return () => {
      cancelled = true;
      leavingRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "Leaving Room");
      socketRef.current = null;
    };
  }, [connect, slug]);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, mode]);

  useEffect(() => {
    if (!policy || policy.readOnly) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= Date.parse(policy.readOnlyAt)) {
        setPolicy((current) => current ? { ...current, readOnly: true } : current);
        setFlashCount(0);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [policy]);

  function sendMessage() {
    const content = draft.trim();
    if (!content || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "message", content, parentId: replyingTo?.id ?? null }));
    setDraft("");
    setReplyingTo(null);
  }

  function react(messageId: string, emoji: string) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "reaction", messageId, emoji }));
    }
  }

  async function submitReport() {
    if (!reporting) return;
    const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: reporting.id, reason: reportReason, details: reportDetails }),
    });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Report sent privately to the moderation team." : result.error ?? "Report could not be sent.");
    if (response.ok) { setReporting(null); setReportDetails(""); }
  }

  async function block(attendeeId: string, displayName: string) {
    if (!window.confirm(`Block ${displayName}? Their messages will be hidden the next time you enter this Room.`)) return;
    const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/block`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendeeId }),
    });
    if (response.ok) {
      setMessages((current) => current.filter((message) => message.attendeeId !== attendeeId));
      setNotice(`${displayName} has been blocked.`);
    } else setNotice("That attendee could not be blocked.");
  }

  if (status === "loading" || (status === "connecting" && !policy)) {
    return <main className="room-gate"><MessageCircle /><p>Opening your verified attendee Room…</p></main>;
  }
  if (status === "denied") {
    return <main className="room-gate"><ShieldCheck /><h1>This Room is ticket-locked.</h1><p>{notice}</p><Link href="/tickets">Open your ticket wallet</Link></main>;
  }

  const pinned = messages.filter((message) => message.pinned && !message.deletedAt).slice(-1)[0];
  return (
    <main className="room-page">
      <header className="room-header">
        <Link href="/tickets"><ArrowLeft size={17} /> Tickets</Link>
        <div><small>The Room</small><strong>{policy?.eventTitle ?? fallbackTitle}</strong><span>{fallbackDate}</span></div>
        <p><Users size={15} /> {online} online</p>
      </header>
      <section className="room-trust"><BadgeCheck size={16} /><b>Verified attendees only</b><span>Every person here entered through an active BeCore ticket.</span><i className={status === "connected" ? "live" : ""}>{status === "connected" ? "Live" : "Reconnecting"}</i></section>
      <nav className="room-modes" aria-label="Room views"><button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}><MessageCircle size={15} /> Chat</button><button className={mode === "flashes" ? "active" : ""} onClick={() => setMode("flashes")}><Camera size={15} /> Flashes{flashCount > 0 && <span>{flashCount}</span>}</button><p>No ticket. No lurking. Nothing follows you home.</p></nav>
      {mode === "chat" && pinned && <aside className="room-pinned"><ShieldCheck size={17} /><div><small>Pinned by the organiser</small><p>{pinned.content}</p></div></aside>}
      {notice && <button className="room-notice" onClick={() => setNotice("")}>{notice}<span>Dismiss</span></button>}
      {mode === "chat" ? <><section className="room-stream" aria-live="polite">
        {messages.length === 0 && <div className="room-empty"><MessageCircle /><h2>The room is open.</h2><p>Ask about entry, organise the meetup, or say something better than “who’s coming?”</p></div>}
        {messages.map((message) => {
          const parent = message.parentId ? messages.find((candidate) => candidate.id === message.parentId) : null;
          const own = message.attendeeId === selfId;
          return <article key={message.id} className={`room-message ${own ? "own" : ""} ${message.kind === "announcement" ? "announcement" : ""}`}>
            {!own && <div className="room-avatar" aria-hidden="true">{message.displayName.slice(0, 1).toUpperCase()}</div>}
            <div className="room-message__body">
              <header><b>{own ? "You" : message.displayName}</b>{message.role !== "attendee" && <span><BadgeCheck size={12} /> Organiser</span>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header>
              <div className="room-bubble">
                {parent && <div className="room-reply-preview"><Reply size={12} /><b>{parent.attendeeId === selfId ? "You" : parent.displayName}</b><span>{parent.content.slice(0, 90)}</span></div>}
                <p className={message.deletedAt ? "removed" : ""}>{message.content}</p>
              </div>
              {!message.deletedAt && <div className="room-message__actions" aria-label={`Actions for ${own ? "your" : message.displayName + "'s"} message`}>
                <button type="button" onClick={() => setReplyingTo(message)} aria-label={`Reply to ${own ? "your message" : message.displayName}`}><Reply size={13} /><span>Reply</span></button>
                {["🔥", "❤️", "😂", "👏", "👀"].map((emoji) => {
                  const reaction = message.reactions.find((item) => item.emoji === emoji);
                  return <button type="button" key={emoji} aria-label={`React ${emoji}`} className={reaction?.mine ? "active" : ""} onClick={() => react(message.id, emoji)}>{emoji}{reaction ? <span>{reaction.count}</span> : null}</button>;
                })}
                {!own && message.role === "attendee" && <><button type="button" onClick={() => setReporting(message)} aria-label={`Report ${message.displayName}'s message`}><Flag size={13} /></button><button type="button" onClick={() => block(message.attendeeId, message.displayName)} aria-label={`Block ${message.displayName}`}><UserRoundX size={13} /></button></>}
              </div>}
            </div>
          </article>;
        })}
        <div ref={bottomRef} />
      </section>
      <section className="room-composer">
        {replyingTo && <div><Reply size={13} /> Replying to <b>{replyingTo.displayName}</b><button onClick={() => setReplyingTo(null)}>Cancel</button></div>}
        {policy?.readOnly ? <p><ShieldCheck size={15} /> This event Room is now read-only. The conversation remains available as an archive.</p> : <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} placeholder="Message The Room" rows={1} />
          <span className={draft.length > 450 ? "near-limit" : ""}>{draft.length ? `${draft.length}/500` : ""}</span><button aria-label="Send message" disabled={!draft.trim() || status !== "connected"}><Send size={18} /></button>
        </form>}
      </section></> : <FlashesPanel slug={slug} readOnly={Boolean(policy?.readOnly)} expiresAt={policy?.readOnlyAt ?? new Date().toISOString()} refreshKey={flashVersion} onCount={setFlashCount} />}
      {reporting && <div className="room-modal" role="dialog" aria-modal="true"><section><Flag /><p className="eyebrow">Private report</p><h2>Tell the moderation team what happened.</h2><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="unsafe">Unsafe behaviour</option><option value="other">Other</option></select></label><label>Details<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 500))} placeholder="Optional context for the moderator" /></label><div><button onClick={() => setReporting(null)}>Cancel</button><button onClick={submitReport}>Send report</button></div></section></div>}
    </main>
  );
}
