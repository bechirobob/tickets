"use client";

import Link from "next/link";
import { BadgeCheck, Bell, CheckCheck, ChevronDown, MessageCircle, Ticket } from "lucide-react";
import { useState } from "react";
import type { NotificationItem, useNotifications } from "./use-notifications";

type Feed = ReturnType<typeof useNotifications>;

function notificationTime(value: string, now: number) {
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Accra" }).format(date);
}

function NotificationRow({ item, mark, now, onNavigate }: { item: NotificationItem; mark: Feed["mark"]; now: number; onNavigate?: () => void }) {
  const host = ["host_update", "gate_update", "event_status"].includes(item.kind);
  const ticket = item.kind === "ticket_transfer";
  const Icon = host ? BadgeCheck : ticket ? Ticket : MessageCircle;
  const long = item.body.length > 150;
  const stamp = new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(item.createdAt));
  return <article className={`buzz-row ${item.readAt ? "read" : "unread"}`}>
    <Icon className="buzz-row-icon" data-kind={host ? "host" : "message"} size={17} aria-hidden="true" />
    <div className="buzz-row-main">
      <header><span>{host ? "Host" : ticket ? "Ticket" : "The Room"}{item.eventTitle ? ` · ${item.eventTitle}` : ""}</span><time dateTime={item.createdAt} title={stamp} aria-label={stamp}>{notificationTime(item.createdAt, now)}</time></header>
      <Link className="buzz-destination" href={item.url} onClick={() => { if (!item.readAt) void mark(item.id); onNavigate?.(); }}>
        <h3>{!item.readAt && <span className="sr-only">Unread: </span>}{item.title}</h3>
        {!long && item.body && <p>{item.body}</p>}
      </Link>
      {long && <details className="buzz-update" onToggle={(event) => { if (event.currentTarget.open && !item.readAt) void mark(item.id); }}><summary aria-label={`Read full update: ${item.title}`}>Read update <ChevronDown size={13} aria-hidden="true" /></summary><p>{item.body}</p></details>}
    </div>
    {!item.readAt && <i className="buzz-unread-dot" aria-hidden="true" />}
  </article>;
}

export default function NotificationFeed({ feed, compact = false, onNavigate }: { feed: Feed; compact?: boolean; onNavigate?: () => void }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const batch = compact ? 8 : 20;
  const [limit, setLimit] = useState(batch);
  const [now] = useState(() => Date.now());
  const { items, loading, locked, loadError, actionError, markingAll, unread, load, mark } = feed;
  const filtered = items?.filter((item) => filter === "all" || !item.readAt) ?? [];
  return <div className="notification-feed">
    {!locked && items && <div className="buzz-tools"><div role="group" aria-label="Filter notifications">{(["all", "unread"] as const).map((view) => <button key={view} type="button" aria-pressed={filter === view} onClick={() => { setFilter(view); setLimit(batch); }}>{view === "all" ? "All" : "Unread"}{view === "unread" && unread > 0 ? <span>{unread}</span> : null}</button>)}</div><button type="button" onClick={() => void mark()} disabled={!unread || markingAll} aria-busy={markingAll}><CheckCheck size={15} aria-hidden="true" />{markingAll ? "Marking…" : "Mark all read"}</button></div>}
    {actionError && <p className="buzz-error" role="alert">{actionError}</p>}
    {loadError && <div className="buzz-load-error"><p role="alert">{loadError}</p><button type="button" disabled={loading} onClick={() => void load()}>Try again</button></div>}
    {loading && !items ? <div className="buzz-skeleton" role="status" aria-label="Loading notifications"><span className="sr-only">Collecting the useful noise…</span>{[0, 1, 2].map((row) => <div key={row} aria-hidden="true"><i /><span><b /><b /></span></div>)}</div> : locked ? <div className="buzz-state"><Bell size={21} aria-hidden="true" /><h2>Your buzz is private.</h2><p>Bring back My Nights to see what you missed.</p><Link href="/my-nights" onClick={onNavigate}>Bring back My Nights</Link></div> : filtered.length ? <><div className="buzz-list">{filtered.slice(0, limit).map((item) => <NotificationRow key={item.id} item={item} mark={mark} now={now} onNavigate={onNavigate} />)}</div>{filtered.length > limit && <button type="button" className="buzz-more" onClick={() => setLimit((current) => current + batch)}>Show more <span>{filtered.length - limit} remaining</span><ChevronDown size={14} aria-hidden="true" /></button>}</> : !loadError && <div className="buzz-state"><CheckCheck size={22} aria-hidden="true" /><h2>{filter === "unread" ? "Nothing missed." : "Quiet. Suspiciously quiet."}</h2><p>{filter === "unread" ? "You’re all caught up." : "When your Night moves, it lands here."}</p></div>}
  </div>;
}
