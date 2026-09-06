"use client";

import { ArrowLeft, Copy, Flag, MoreHorizontal, Reply, UserRoundX } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { RoomReaction } from "../../room-chat-parts";

type Reaction = { emoji: string; count: number; mine: boolean };

export default function MessageTools({ children, content, name, own, disabled, removed, reactions, onReact, onReply, onReport, onBlock }: {
  children: ReactNode; content: string; name: string; own: boolean; disabled: boolean; removed: boolean; reactions: Reaction[];
  onReact: (emoji: string) => void; onReply: () => void; onReport?: () => void; onBlock?: () => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [more, setMore] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  function cancelHold() { if (hold.current) clearTimeout(hold.current); hold.current = null; }
  useEffect(() => () => { cancelHold(); if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  function positionTray() {
    if (!anchor.current || !tray.current) return;
    const bubble = anchor.current.getBoundingClientRect();
    const shelf = { width: tray.current.offsetWidth, height: tray.current.offsetHeight };
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    tray.current.style.left = `${Math.max(left + 12, Math.min(own ? bubble.right - shelf.width : bubble.left, left + width - shelf.width - 12))}px`;
    const preferred = bubble.top - shelf.height - 8 >= top + 12 ? bubble.top - shelf.height - 8 : bubble.bottom + 8;
    tray.current.style.top = `${Math.max(top + 12, Math.min(preferred, top + height - shelf.height - 12))}px`;
  }

  const close = useCallback((restore = false, after?: () => void) => {
    if (closingRef.current) return;
    cancelHold();
    closingRef.current = true;
    setClosing(true);
    const finish = () => {
      tray.current?.hidePopover(); setOpen(false); setClosing(false); closingRef.current = false;
      if (restore || after) trigger.current?.focus({ preventScroll: true });
      after?.();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else exitTimer.current = setTimeout(finish, 140);
  }, []);

  function openActions() {
    cancelHold();
    if (removed || !tray.current || open || closingRef.current) return;
    setMore(false); setCopyStatus(""); setOpen(true);
    tray.current.showPopover(); positionTray();
    tray.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: globalThis.PointerEvent) {
      if (!tray.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      if (event.key === "Tab") close();
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && tray.current?.contains(document.activeElement)) {
        event.preventDefault();
        const buttons = Array.from(tray.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    }
    const hide = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.visualViewport?.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.visualViewport?.removeEventListener("resize", hide);
    };
  }, [open, close]);

  async function copy() {
    try { await navigator.clipboard.writeText(content); close(true); }
    catch { setCopyStatus("Copy is unavailable. Select the message text instead."); }
  }

  function startHold(event: PointerEvent) {
    if (event.pointerType === "mouse" || !event.isPrimary || removed) return;
    origin.current = { x: event.clientX, y: event.clientY };
    cancelHold();
    hold.current = setTimeout(openActions, 450);
  }

  return <div ref={anchor} className={`chat-message-anchor${open ? " is-active" : ""}`}>
    <div className="room-bubble" onPointerDown={startHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onPointerMove={(event) => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancelHold(); }} onContextMenu={(event) => { if (!removed) { event.preventDefault(); openActions(); } }} onDoubleClick={openActions}>{children}</div>
    {!removed && reactions.length > 0 && <div className="chat-tapbacks" aria-label="Message reactions">{reactions.map((reaction) => <button key={reaction.emoji} type="button" aria-label={`${reaction.emoji}, ${reaction.count} reactions`} aria-pressed={reaction.mine} disabled={disabled} onClick={() => onReact(reaction.emoji)}><RoomReaction emoji={reaction.emoji} count={reaction.count} /></button>)}</div>}
    {!removed && <>
      <button ref={trigger} type="button" className="room-message-menu" aria-label={`Actions for ${own ? "your" : name + "'s"} message`} aria-expanded={open} aria-controls={id} onClick={() => open ? close(true) : openActions()}><MoreHorizontal size={18} /></button>
      <div ref={tray} id={id} popover="manual" role="toolbar" aria-label={`Actions for ${own ? "your" : name + "'s"} message`} className="chat-action-tray" data-phase={closing ? "closing" : "open"}>
        <div className="chat-action-reactions" role="group" aria-label="Choose a reaction">{["🔥", "❤️", "😂", "👏", "👀"].map((emoji) => <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={reactions.some((reaction) => reaction.emoji === emoji && reaction.mine)} disabled={disabled || closing} onClick={() => { onReact(emoji); close(true); }}><span>{emoji}</span></button>)}</div>
        <div className="chat-action-links">{more ? <>
          <button type="button" aria-label="Back to message actions" onClick={() => setMore(false)}><ArrowLeft size={14} /></button>
          {onReport && <button type="button" onClick={() => close(false, onReport)}><Flag size={14} />Report</button>}
          {onBlock && <button type="button" onClick={() => close(false, onBlock)}><UserRoundX size={14} />Block</button>}
        </> : <>
          <button type="button" disabled={disabled} onClick={() => close(false, onReply)}><Reply size={14} />Reply</button>
          <button type="button" onClick={() => void copy()}><Copy size={14} />Copy</button>
          {(onReport || onBlock) && <button type="button" aria-label="More message actions" onClick={() => setMore(true)}><MoreHorizontal size={16} /></button>}
        </>}</div>
        {copyStatus && <p className="chat-action-feedback" role="status">{copyStatus}</p>}
      </div>
    </>}
  </div>;
}
