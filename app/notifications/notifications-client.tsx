"use client";

import Link from "next/link";
import { ArrowLeft, Bell, CheckCheck, MessageCircle, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingSkeleton from "../loading-skeleton";

type Item = { id: string; eventSlug: string | null; kind: string; title: string; body: string; url: string; createdAt: string; readAt: string | null };

export default function NotificationsClient() {
  const params = useSearchParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/customer/notifications", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { setLocked(true); return; }
      const data = await response.json() as { notifications?: Item[] };
      setItems(data.notifications ?? []);
    }).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    const slug = params.get("mute");
    if (!slug || !/^[a-z0-9-]{1,80}$/u.test(slug)) return;
    void fetch(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mute: "tonight" }),
    }).then((response) => { if (response.ok) setNotice("That Room is quiet for tonight. Your lock screen may rest."); });
  }, [params]);

  async function mark(id?: string) {
    await fetch("/api/customer/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) });
    setItems((current) => current?.map((item) => !id || item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item) ?? current);
  }

  if (locked) return <main className="notification-page notification-page--locked"><Bell /><h1>Your buzz is private.</h1><p>Open My Nights with the email used at checkout, then every Room ping and Host update lands here.</p><Link href="/my-nights">Bring back My Nights</Link></main>;
  if (!items) return <LoadingSkeleton kind="wallet" label="Collecting the useful noise" />;
  return <main className="notification-page">
    <header><Link href="/my-nights"><ArrowLeft size={16} /> My Nights</Link><div><p className="eyebrow">Your notification panel</p><h1>The Buzz</h1><span>Room messages, Host updates and ticket moves. All the things worth interrupting you for.</span></div><button type="button" onClick={() => void mark()} disabled={!items.some((item) => !item.readAt)}><CheckCheck size={15} /> Mark all read</button></header>
    {notice ? <button className="notification-page__notice" type="button" onClick={() => setNotice("")}>{notice}</button> : null}
    <section>{items.length ? items.map((item) => <Link key={item.id} href={item.url} className={item.readAt ? "read" : "unread"} onClick={() => void mark(item.id)}><span>{item.kind === "ticket_transfer" ? <Ticket /> : <MessageCircle />}</span><div><small>{item.eventSlug ? item.eventSlug.replaceAll("-", " ") : "My Nights"}</small><h2>{item.title}</h2><p>{item.body}</p><time>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(item.createdAt))}</time></div>{!item.readAt ? <i>New</i> : null}</Link>) : <div className="notification-empty"><Bell /><h2>Quiet. Suspiciously quiet.</h2><p>When The Room moves or the Host says something useful, it will land here.</p></div>}</section>
  </main>;
}
