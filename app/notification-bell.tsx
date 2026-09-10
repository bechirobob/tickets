"use client";

import Link from "next/link";
import { Bell, ArrowUpRight, X } from "lucide-react";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import NotificationFeed from "./notifications/notification-feed";
import { useNotifications } from "./notifications/use-notifications";
import { useHeaderPanel } from "./use-header-panel";

export default function NotificationBell() {
  const feed = useNotifications();
  const { id, trigger, panel, mounted, open, phase, ready, toggle, close } = useHeaderPanel();
  const [position, setPosition] = useState({ top: 64, right: 12 });
  const anchor = trigger;
  useLayoutEffect(() => {
    if (!mounted) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setPosition({ top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 240)), right: Math.max(12, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, mounted]);
  return <><button ref={trigger} type="button" className="notification-bell" disabled={!ready} aria-busy={!ready} aria-label={feed.unread ? `${feed.unread} unread notifications` : "Notifications"} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} onClick={(event) => { toggle(event.detail === 0); if (!open) void feed.load(); }}><Bell size={17} aria-hidden="true" />{feed.unread ? <b>{feed.unread > 9 ? "9+" : feed.unread}</b> : null}</button>
    {mounted && createPortal(<section ref={panel} id={id} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary')].filter((element) => element.getClientRects().length && !element.closest('[inert]'));
      if ((!event.shiftKey && event.target === controls.at(-1)) || (event.shiftKey && event.target === controls[0])) close();
    }} role="dialog" aria-label="The Buzz" aria-modal="false" inert={!open} data-phase={phase} className="notification-panel notification-panel--dropdown" style={{ "--notification-top": `${position.top}px`, "--notification-right": `${position.right}px` } as CSSProperties}>
      <header className="notification-panel-header"><div><h2>The Buzz</h2></div><button type="button" onClick={() => close(true)} aria-label="Close notifications"><X size={19} aria-hidden="true" /></button></header>
      <div className="notification-panel-scroll"><NotificationFeed feed={feed} compact onNavigate={() => close()} /></div>
      <footer><Link href="/notifications" onClick={() => close()}>Open inbox <ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
    </section>, document.body)}
  </>;
}
