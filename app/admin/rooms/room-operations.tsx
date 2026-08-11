"use client";
/* eslint-disable @next/next/no-img-element -- private, cookie-authenticated moderation media cannot pass through the public optimizer */

import { Camera, Flag, Megaphone, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Report = {
  id: string; eventSlug: string; messageId: string; reason: string; details: string | null; status: string; createdAt: string;
  message: { displayName: string; content: string; createdAt: string; deletedAt: string | null } | null;
};
type FlashReport = {
  id: string; flashId: string; eventSlug: string; reason: string; details: string | null; status: string; createdAt: string;
  flashStatus: string; attendeeId: string; displayName: string;
};

export default function RoomOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [flashReports, setFlashReports] = useState<FlashReport[]>([]);
  const [events, setEvents] = useState<{ slug: string; title: string }[]>([]);
  const [eventSlug, setEventSlug] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [pinned, setPinned] = useState(true);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/rooms", { cache: "no-store" });
    const result = await response.json() as { reports?: Report[]; flashReports?: FlashReport[]; events?: { slug: string; title: string }[]; error?: string };
    if (response.ok) { setReports(result.reports ?? []); setFlashReports(result.flashReports ?? []); setEvents(result.events ?? []); setEventSlug((current) => current || result.events?.[0]?.slug || ""); } else setNotice(result.error ?? "Reports could not be loaded.");
  }, []);
  useEffect(() => {
    fetch("/api/admin/rooms", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as { reports?: Report[]; flashReports?: FlashReport[]; events?: { slug: string; title: string }[]; error?: string } }))
      .then(({ response, result }) => {
        if (response.ok) { setReports(result.reports ?? []); setFlashReports(result.flashReports ?? []); setEvents(result.events ?? []); setEventSlug(result.events?.[0]?.slug || ""); }
        else setNotice(result.error ?? "Reports could not be loaded.");
      })
      .catch(() => setNotice("Reports could not be loaded."));
  }, []);

  async function publish() {
    setWorking(true); setNotice("");
    const response = await fetch("/api/admin/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventSlug, content: announcement, pinned }) });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Announcement is live in The Room." : result.error ?? "Announcement failed.");
    if (response.ok) setAnnouncement("");
    setWorking(false);
  }

  async function remove(report: Report) {
    if (!window.confirm("Remove this message and resolve every open report against it?")) return;
    const response = await fetch("/api/admin/rooms", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventSlug: report.eventSlug, messageId: report.messageId, note: `Removed from report ${report.id}` }) });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Message removed and report action recorded." : result.error ?? "Moderation action failed.");
    if (response.ok) await load();
  }

  async function removeFlash(report: FlashReport) {
    if (!window.confirm("Remove this Flash permanently and resolve every open report against it?")) return;
    const response = await fetch(`/api/admin/rooms/flashes/${encodeURIComponent(report.flashId)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Flash removed permanently and the action was recorded." : result.error ?? "Moderation action failed.");
    if (response.ok) await load();
  }

  return <main className="room-ops">
    <OperationsNav actor={actor} role={role} active="/admin/rooms" />
    <section>
      <header><div><p>Verified attendee operations</p><h1>Room + Flashes</h1></div><button onClick={load}><RefreshCw size={14} /> Refresh reports</button></header>
      {notice && <button className="room-ops__notice" onClick={() => setNotice("")}>{notice}</button>}
      <div className="room-ops__grid">
        <article className="room-ops__announce"><Megaphone /><p className="eyebrow">Organiser announcement</p><h2>Speak once. Reach the whole verified room.</h2><label>Event<select value={eventSlug} onChange={(event) => setEventSlug(event.target.value)}>{events.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select></label><label>Announcement<textarea maxLength={500} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Entry update, set time, directions or another useful event notice" /></label><label className="room-ops__check"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> Pin this above the conversation</label><button onClick={publish} disabled={working || !announcement.trim() || !eventSlug}>Publish to The Room</button></article>
        <article className="room-ops__reports"><header><div><Flag /><span><b>{reports.filter((report) => report.status === "open").length}</b> open reports</span></div></header>{reports.length === 0 ? <p className="room-ops__empty">No attendee reports. Quiet is good when it is real.</p> : reports.map((report) => <section key={report.id}><div><span>{report.reason}</span><time>{new Date(report.createdAt).toLocaleString("en-GH")}</time></div><blockquote>{report.message?.deletedAt ? "Message already removed" : report.message?.content ?? "Message unavailable"}</blockquote><p>{report.message?.displayName ?? "Unknown attendee"} · {report.eventSlug}</p>{report.details && <small>Reporter context: {report.details}</small>}{report.status === "open" && report.message && !report.message.deletedAt && <button onClick={() => remove(report)}><Trash2 size={13} /> Remove message</button>}</section>)}</article>
        <article className="room-ops__reports room-ops__flashes"><header><div><Camera /><span><b>{flashReports.filter((report) => report.status === "open").length}</b> Flash reports</span></div></header>{flashReports.length === 0 ? <p className="room-ops__empty">No reported Flashes.</p> : flashReports.map((report) => <section key={report.id}><div><span>{report.reason}</span><time>{new Date(report.createdAt).toLocaleString("en-GH")}</time></div>{report.flashStatus !== "deleted" && <img src={`/api/admin/rooms/flashes/${encodeURIComponent(report.flashId)}`} alt={`Reported Flash from ${report.displayName}`} />}<p>{report.displayName} · {report.eventSlug}</p>{report.details && <small>Reporter context: {report.details}</small>}{report.status === "open" && report.flashStatus !== "deleted" && <button onClick={() => removeFlash(report)}><Trash2 size={13} /> Remove Flash permanently</button>}</section>)}</article>
      </div>
    </section>
  </main>;
}
