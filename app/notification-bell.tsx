"use client";

import Link from "next/link";
import { Bell, ArrowUpRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import NotificationFeed from "./notifications/notification-feed";
import { useNotifications } from "./notifications/use-notifications";
import { useHeaderPanel } from "./use-header-panel";
import { useTopPanelPosition } from "./use-top-panel-position";

export default function NotificationBell() {
  const feed = useNotifications();
  const { id, trigger, panel, mounted, open, phase, ready, toggle, close } = useHeaderPanel();
  const position = useTopPanelPosition(mounted, trigger, () => close(true, true));
  return <><button ref={trigger} type="button" className="notification-bell" disabled={!ready} aria-busy={!ready} aria-label={feed.unread ? `${feed.unread} unread notifications` : "Notifications"} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} onClick={(event) => { toggle(event.detail === 0); if (!open) void feed.load(); }}><Bell size={17} aria-hidden="true" />{feed.unread ? <b>{feed.unread > 9 ? "9+" : feed.unread}</b> : null}</button>
    {mounted && createPortal(<section ref={panel} id={id} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary')].filter((element) => element.getClientRects().length && !element.closest('[inert]'));
      if ((!event.shiftKey && event.target === controls.at(-1)) || (event.shiftKey && event.target === controls[0])) close();
    }} role="dialog" aria-label="The Buzz" aria-modal="false" inert={!open} data-phase={phase} className="notification-panel notification-panel--dropdown" style={position}>
      <header className="notification-panel-header"><div><h2>The Buzz</h2></div><button type="button" onClick={() => close(true)} aria-label="Close notifications"><X size={19} aria-hidden="true" /></button></header>
      <div className="notification-panel-scroll"><NotificationFeed feed={feed} compact onNavigate={() => close()} /></div>
      <footer><Link href="/notifications" onClick={() => close()}>Open inbox <ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
    </section>, document.body)}
  </>;
}
