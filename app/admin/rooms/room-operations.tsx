"use client";
/* eslint-disable jsx-a11y/alt-text -- the imported Image glyph is an icon, not content imagery */
/* eslint-disable react-hooks/set-state-in-effect -- changing the selected Room intentionally resets its draft controls */
/* eslint-disable @next/next/no-img-element -- private, cookie-authenticated moderation media cannot pass through the public optimizer */

import { Camera, Flag, Image, Megaphone, RefreshCw, ShieldAlert as ShieldPause, Trash2, UserRoundCheck, UserRoundX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Report = {
  id: string; eventSlug: string; messageId: string; reason: string; details: string | null; status: string; createdAt: string;
  message: { attendeeId: string; displayName: string; content: string; createdAt: string; deletedAt: string | null } | null;
};
type RoomSetting = { eventSlug: string; emergencyReadOnly: number | boolean; slowModeSeconds: number; archivedAt: string | null };
type Suspension = { eventSlug: string; attendeeId: string; displayName: string; reason: string; suspendedAt: string };
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
  const [settings, setSettings] = useState<RoomSetting[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const [emergencyReadOnly, setEmergencyReadOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryBody, setMemoryBody] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/rooms", { cache: "no-store" });
    const result = await response.json() as { reports?: Report[]; flashReports?: FlashReport[]; events?: { slug: string; title: string }[]; settings?: RoomSetting[]; suspensions?: Suspension[]; error?: string };
    if (response.ok) { setReports(result.reports ?? []); setFlashReports(result.flashReports ?? []); setEvents(result.events ?? []); setSettings(result.settings ?? []); setSuspensions(result.suspensions ?? []); setEventSlug((current) => current || result.events?.[0]?.slug || ""); } else setNotice(result.error ?? "Reports could not be loaded.");
  }, []);
  useEffect(() => {
    fetch("/api/admin/rooms", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as { reports?: Report[]; flashReports?: FlashReport[]; events?: { slug: string; title: string }[]; settings?: RoomSetting[]; suspensions?: Suspension[]; error?: string } }))
      .then(({ response, result }) => {
        if (response.ok) { setReports(result.reports ?? []); setFlashReports(result.flashReports ?? []); setEvents(result.events ?? []); setSettings(result.settings ?? []); setSuspensions(result.suspensions ?? []); setEventSlug(result.events?.[0]?.slug || ""); }
        else setNotice(result.error ?? "Reports could not be loaded.");
      })
      .catch(() => setNotice("Reports could not be loaded."));
  }, []);

  useEffect(() => {
    const setting = settings.find((item) => item.eventSlug === eventSlug);
    setSlowModeSeconds(setting?.slowModeSeconds ?? 0);
    setEmergencyReadOnly(Boolean(setting?.emergencyReadOnly));
    setArchived(Boolean(setting?.archivedAt));
  }, [eventSlug, settings]);

  const selectedEvent = events.find((item) => item.slug === eventSlug);
  const selectedReports = reports.filter((report) => report.eventSlug === eventSlug);
  const selectedFlashReports = flashReports.filter((report) => report.eventSlug === eventSlug);
  const selectedSuspensions = suspensions.filter((item) => item.eventSlug === eventSlug);

  async function operate(body: Record<string, unknown>, success: string) {
    setWorking(true); setNotice("");
    const response = await fetch("/api/admin/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventSlug, ...body }) });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? success : result.error ?? "Room operation failed.");
    setWorking(false);
    if (response.ok) await load();
  }

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

  async function publishMemory() {
    await operate({ action: "memory", title: memoryTitle, content: memoryBody }, "Memory published inside this Night.");
    setMemoryTitle(""); setMemoryBody("");
  }

  return <main className="room-ops">
    <OperationsNav actor={actor} role={role} active="/admin/rooms" />
    <section>
      <header><div><p>Verified attendee operations</p><h1>Room + Flashes</h1></div><button onClick={load}><RefreshCw size={14} /> Refresh reports</button></header>
      {notice && <button className="room-ops__notice" onClick={() => setNotice("")}>{notice}</button>}
      <div className="workspace-event-picker room-ops__event">
        <label htmlFor="room-event">Night</label>
        <select id="room-event" value={eventSlug} onChange={(event) => setEventSlug(event.target.value)}>{events.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select>
        <span>{selectedEvent ? `${selectedReports.filter((report) => report.status === "open").length + selectedFlashReports.filter((report) => report.status === "open").length} open reports · ${selectedSuspensions.length} suspended` : "Choose a Night to manage its Room."}</span>
      </div>
      <div className="room-ops__control-grid">
        <article className="room-ops__panel"><ShieldPause /><p className="eyebrow">Conversation</p><h2>Pace or pause.</h2><div className="room-ops__compact-controls"><label>Slow mode<select value={slowModeSeconds} onChange={(event) => setSlowModeSeconds(Number(event.target.value))}><option value="0">Off</option><option value="5">5 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label><label className="room-ops__check"><input type="checkbox" checked={emergencyReadOnly} onChange={(event) => setEmergencyReadOnly(event.target.checked)} /> Emergency read-only</label><label className="room-ops__check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Archive Room</label><button onClick={() => operate({ action: "settings", slowModeSeconds, emergencyReadOnly, archived }, "Room controls saved.")} disabled={working || !eventSlug}>Apply controls</button><button onClick={() => operate({ action: "clear_pin" }, "Pinned announcement cleared.")} disabled={working || !eventSlug}>Clear pin</button></div></article>
        <article className="room-ops__panel"><Megaphone /><p className="eyebrow">Host update</p><h2>Speak to the Room.</h2><label>Announcement<textarea maxLength={500} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Entry update, set time or useful event notice" /></label><label className="room-ops__check"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> Pin above chat</label><button onClick={publish} disabled={working || !announcement.trim() || !eventSlug}>Publish update</button></article>
        <article className="room-ops__panel"><Image /><p className="eyebrow">Official memory</p><h2>Close the loop.</h2><label>Title<input maxLength={120} value={memoryTitle} onChange={(event) => setMemoryTitle(event.target.value)} placeholder="The night, officially" /></label><label>Note<textarea maxLength={800} value={memoryBody} onChange={(event) => setMemoryBody(event.target.value)} placeholder="A short post-night note. Event artwork is attached." /></label><button onClick={publishMemory} disabled={working || !memoryTitle.trim() || !memoryBody.trim() || !eventSlug}>Publish memory</button></article>
      </div>
      <section className="room-ops__moderation">
        <header><div><p className="eyebrow">Moderation</p><h2>Only this Night.</h2></div><span>{selectedReports.length} messages · {selectedFlashReports.length} Flashes · {selectedSuspensions.length} suspended</span></header>
        <div>
          <article className="room-ops__reports"><header><div><Flag /><span><b>{selectedReports.filter((report) => report.status === "open").length}</b> Messages</span></div></header>{selectedReports.length === 0 ? <p className="room-ops__empty">No attendee reports. Quiet is good when it is real.</p> : selectedReports.map((report) => <section key={report.id}><div><span>{report.reason}</span><time>{new Date(report.createdAt).toLocaleString("en-GH")}</time></div><blockquote>{report.message?.deletedAt ? "Message already removed" : report.message?.content ?? "Message unavailable"}</blockquote><p>{report.message?.displayName ?? "Unknown attendee"}</p>{report.details && <small>Reporter context: {report.details}</small>}{report.status === "open" && report.message && !report.message.deletedAt && <div className="room-ops__row"><button onClick={() => remove(report)}><Trash2 size={13} /> Remove</button><button onClick={() => operate({ action: "suspend", attendeeId: report.message?.attendeeId, reason: `Report: ${report.reason}` }, "Attendee suspended from this Room.")}><UserRoundX size={13} /> Suspend</button></div>}</section>)}</article>
          <article className="room-ops__reports room-ops__flashes"><header><div><Camera /><span><b>{selectedFlashReports.filter((report) => report.status === "open").length}</b> Flashes</span></div></header>{selectedFlashReports.length === 0 ? <p className="room-ops__empty">No reported Flashes.</p> : selectedFlashReports.map((report) => <section key={report.id}><div><span>{report.reason}</span><time>{new Date(report.createdAt).toLocaleString("en-GH")}</time></div>{report.flashStatus !== "deleted" && <img src={`/api/admin/rooms/flashes/${encodeURIComponent(report.flashId)}`} alt={`Reported Flash from ${report.displayName}`} />}<p>{report.displayName}</p>{report.details && <small>Reporter context: {report.details}</small>}{report.status === "open" && report.flashStatus !== "deleted" && <button onClick={() => removeFlash(report)}><Trash2 size={13} /> Remove permanently</button>}</section>)}</article>
          <article className="room-ops__reports"><header><div><UserRoundX /><span><b>{selectedSuspensions.length}</b> Suspended</span></div></header>{selectedSuspensions.length === 0 ? <p className="room-ops__empty">Nobody is suspended from this Room.</p> : selectedSuspensions.map((item) => <section key={item.attendeeId}><div><span>Suspended</span><time>{new Date(item.suspendedAt).toLocaleString("en-GH")}</time></div><p>{item.displayName}</p><small>{item.reason}</small><button onClick={() => operate({ action: "restore", attendeeId: item.attendeeId }, "Attendee restored to this Room.")}><UserRoundCheck size={13} /> Restore</button></section>)}</article>
        </div>
      </section>
    </section>
  </main>;
}
