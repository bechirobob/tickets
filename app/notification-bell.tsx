"use client";

import Link from "next/link";
import { Bell, ArrowUpRight, X } from "lucide-react";
import { useRef, useState } from "react";
import NotificationFeed from "./notifications/notification-feed";
import NotificationPanel from "./notifications/notification-panel";
import { useNotifications } from "./notifications/use-notifications";

export default function NotificationBell() {
  const feed = useNotifications();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} type="button" className="notification-bell" aria-label={feed.unread ? `${feed.unread} unread notifications` : "Notifications"} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); void feed.load(); }}><Bell size={17} aria-hidden="true" />{feed.unread ? <b>{feed.unread > 9 ? "9+" : feed.unread}</b> : null}</button>
    {open && <NotificationPanel anchor={trigger} label="The Buzz" onClose={() => setOpen(false)}>{(dismiss) => <><header className="notification-panel-header"><div><h2>The Buzz</h2><span>Only the useful noise.</span></div><button type="button" onClick={dismiss} aria-label="Close notifications"><X size={19} aria-hidden="true" /></button></header><div className="notification-panel-scroll"><NotificationFeed feed={feed} compact onNavigate={() => setOpen(false)} /></div><footer><Link href="/notifications" onClick={() => setOpen(false)}>Open inbox <ArrowUpRight size={14} aria-hidden="true" /></Link></footer></>}</NotificationPanel>}
  </>;
}
