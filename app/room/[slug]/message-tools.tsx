"use client";

import { Flag, MoreHorizontal, Reply, UserRoundX } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { RoomReaction } from "../../room-chat-parts";

type Reaction = { emoji: string; count: number; mine: boolean };

export default function MessageTools({ children, name, own, disabled, removed, reactions, onReact, onReply, onReport, onBlock }: {
  children: ReactNode; name: string; own: boolean; disabled: boolean; removed: boolean; reactions: Reaction[];
  onReact: (emoji: string) => void; onReply: () => void; onReport?: () => void; onBlock?: () => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);

  function cancelHold() { if (hold.current) clearTimeout(hold.current); hold.current = null; }
  useEffect(() => cancelHold, []);

  function positionTray() {
    if (!anchor.current || !tray.current) return;
    const bubble = anchor.current.getBoundingClientRect();
    const shelf = tray.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    tray.current.style.left = `${Math.max(left + 12, Math.min(own ? bubble.right - shelf.width : bubble.left, left + width - shelf.width - 12))}px`;
    const preferred = bubble.top - shelf.height - 8 >= top + 12 ? bubble.top - shelf.height - 8 : bubble.bottom + 8;
    tray.current.style.top = `${Math.max(top + 12, Math.min(preferred, top + height - shelf.height - 12))}px`;
  }

  function close(restore = false) {
    tray.current?.hidePopover();
    if (restore) trigger.current?.focus({ preventScroll: true });
  }

  function openActions() {
    cancelHold();
    if (removed || !tray.current) return;
    tray.current.showPopover();
    positionTray();
    tray.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const hide = () => tray.current?.hidePopover();
    // A scrolling conversation must never leave a reaction shelf floating behind.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.visualViewport?.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.visualViewport?.removeEventListener("resize", hide);
    };
  }, [open]);

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
      <button ref={trigger} type="button" className="room-message-menu" aria-label={`Actions for ${own ? "your" : name + "'s"} message`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => open ? close(true) : openActions()}><MoreHorizontal size={18} /></button>
      <div ref={tray} id={id} popover="auto" role="dialog" aria-label={`Actions for ${own ? "your" : name + "'s"} message`} className="chat-action-tray" onToggle={(event) => setOpen(event.newState === "open")} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true); } }}>
        <div className="chat-action-reactions" aria-label="Choose a reaction">{["🔥", "❤️", "😂", "👏", "👀"].map((emoji) => <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={reactions.some((reaction) => reaction.emoji === emoji && reaction.mine)} disabled={disabled} onClick={() => { onReact(emoji); close(true); }}>{emoji}</button>)}</div>
        <div className="chat-action-links"><button type="button" disabled={disabled} onClick={() => { close(); onReply(); }}><Reply size={16} />Reply</button>{onReport && <button type="button" onClick={() => { close(); onReport(); }}><Flag size={16} />Report</button>}{onBlock && <button type="button" onClick={() => { close(); onBlock(); }}><UserRoundX size={16} />Block</button>}</div>
      </div>
    </>}
  </div>;
}
