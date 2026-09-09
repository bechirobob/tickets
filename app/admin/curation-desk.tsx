/* eslint-disable @next/next/no-img-element -- moderation images are private API responses and must bypass the public image optimizer. */
"use client";

import { operationsFetch } from "../../lib/operations-client";

import { CalendarClock, Check, ChevronRight, Eye, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import OperationsNav from "./operations-nav";
import type { StaffRole } from "../../lib/admin-session";

type Submission = {
  id: string; organizerName: string; contactName: string; contactEmail: string; contactPhone: string;
  title: string; concept: string; venueName: string; venueMapUrl: string | null; area: string; startsAt: string; endsAt: string;
  vibe: string; lineup: string; capacity: number; priceFromMinor: number; ageRestriction: string;
  posterObjectKey: string | null; status: string; reviewNote: string | null; curationNote: string | null; tagline: string | null;
  scheduledPublishAt: string | null; eventSlug: string | null; createdAt: string;
};

const labels: Record<string, string> = { submitted: "New", in_review: "In review", changes_requested: "Changes requested", approved: "Approved", rejected: "Rejected", scheduled: "Scheduled", published: "Published", unpublished: "Unpublished", archived: "Archived" };

export default function CurationDesk({ actor, role }: { actor: string; role: StaffRole }) {
  const [view, setView] = useState("active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [curationNote, setCurationNote] = useState("");
  const [tagline, setTagline] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const applyLoadedItems = useCallback((submissions: Submission[]) => {
    setItems(submissions);
  }, []);

  const load = useCallback(async () => {
    const response = await operationsFetch("/api/admin/submissions", { cache: "no-store" });
    const result = await response.json() as { submissions?: Submission[]; error?: string };
    if (!response.ok) { setError(result.error ?? "Could not load the curation queue."); setLoading(false); return; }
    applyLoadedItems(result.submissions ?? []);
    setLoading(false);
  }, [applyLoadedItems]);

  useEffect(() => {
    operationsFetch("/api/admin/submissions", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as { submissions?: Submission[]; error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) setError(result.error ?? "Could not load the curation queue.");
        else applyLoadedItems(result.submissions ?? []);
        setLoading(false);
      })
      .catch(() => { setError("Could not load the curation queue."); setLoading(false); });
  }, [applyLoadedItems]);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  function selectItem(item: Submission) {
    setSelectedId(item.id);
    setNote(item.reviewNote ?? "");
    setCurationNote(item.curationNote ?? "");
    setTagline(item.tagline ?? "");
    setScheduledAt(item.scheduledPublishAt?.slice(0, 16) ?? "");
    setError("");
  }

  async function act(action: string) {
    if (!selected || working) return;
    setWorking(true); setError("");
    const response = await operationsFetch("/api/admin/submissions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, action, note, curationNote, tagline, scheduledPublishAt: scheduledAt ? `${scheduledAt}:00.000Z` : "" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "The review action failed.");
    else { await load(); if (["approve", "reject", "archive", "publish", "schedule", "unpublish"].includes(action)) { setSelectedId(null); setNotice(action === "reject" ? "Submission rejected. Find it under Rejected." : action === "approve" ? "Submission approved. Find it under Accepted to publish or schedule it." : "Submission updated."); } }
    setWorking(false);
  }

  const groups: Record<string, string[]> = { active: ["submitted", "in_review", "changes_requested"], accepted: ["approved", "scheduled", "published"], rejected: ["rejected"], history: ["unpublished", "archived"] };
  const filtered = items.filter(item => groups[view].includes(item.status) && `${item.title} ${item.organizerName} ${item.area}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * 10, Math.min(page, pageCount) * 10);
  return (
    <main className="curation-page">
      <OperationsNav actor={actor} role={role} active="/admin" />
      <section className="curation-main">
        <header><div><p>BeCore editorial operations</p><h1>Submission queue</h1></div><span>{items.filter((item) => item.status === "submitted").length} waiting</span></header>
        {error && !selected ? <p className="curation-error" role="alert">{error} <button onClick={() => void load()}>Retry</button></p> : null}
        {notice ? <p className="ops-message" role="status">{notice}</p> : null}
        {!selected ? <>
          <nav className="ops-tabs" aria-label="Submission views">{Object.entries({ active: "Needs review", accepted: "Accepted", rejected: "Rejected", history: "History" }).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }}>{label} <span>{items.filter(item => groups[key].includes(item.status)).length}</span></button>)}</nav>
          <label className="ops-search">Search submissions<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Event, organiser or area" /></label>
          {loading ? <p role="status">Loading submissions…</p> : <div className="ops-directory">{visible.map(item => <button key={item.id} className="ops-directory__row" onClick={() => selectItem(item)}><span><b>{item.title}</b><small>{item.organizerName} · {item.area}</small></span><span className={`review-status ${item.status}`}>{labels[item.status]}</span><time>{new Date(item.startsAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", timeZone: "Africa/Accra" })}</time><ChevronRight size={16} /></button>)}{!visible.length ? <p className="ops-empty">{query ? "No matching submissions." : view === "active" ? "Nothing needs review. New submissions will appear here." : "No submissions in this view."}</p> : null}</div>}
          <nav className="order-pagination" aria-label="Submission pages"><span>{filtered.length} submissions</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>{Math.min(page, pageCount)} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</button></div></nav>
        </> : <div className="ops-detail-view"><button className="ops-back" disabled={working} onClick={() => setSelectedId(null)}>← Back to submissions</button>
            {selected && <article className="curation-detail">
              <div className="curation-detail__head"><div><span className={`review-status ${selected.status}`}>{labels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.organizerName} · submitted {new Date(selected.createdAt).toLocaleDateString("en-GH")}</p></div>{selected.posterObjectKey && <img src={`/api/media/${selected.id}`} alt={`${selected.title} poster`} />}</div>
              <div className="curation-facts"><span><small>When</small>{new Date(selected.startsAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</span><span><small>Where</small>{selected.venueName}, {selected.area}</span><span><small>Commercial</small>GH₵{(selected.priceFromMinor / 100).toFixed(0)} · {selected.capacity} guests</span><span><small>Audience</small>{selected.ageRestriction} · {selected.vibe}</span></div>
              <section><h3>The pitch</h3><p>{selected.concept}</p></section>
              <section><h3>Line-up</h3><p>{selected.lineup}</p></section>
              <section><h3>Contact</h3><p>{selected.contactName} · {selected.contactEmail} · {selected.contactPhone}</p></section>
              <label>Event line<input maxLength={100} value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="One original line, written for this event." /></label>
              <label>Why it made the list<textarea value={curationNote} onChange={(event) => setCurationNote(event.target.value)} placeholder="Customer-facing editorial note. Keep it specific and useful." /></label>
              <label>Private / organiser note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain requested changes or rejection clearly." /></label>
              <label>Publication time (Ghana time)<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
              {error && <p className="curation-error" role="alert">{error}</p>}
              <div className="curation-actions">
                {["rejected", "unpublished"].includes(selected.status) && <button onClick={() => act("archive")} disabled={working}>Archive submission</button>}
                {selected.status === "submitted" && <button onClick={() => act("start_review")} disabled={working}><Eye size={15} /> Start review</button>}
                {["submitted", "in_review", "approved"].includes(selected.status) && <button onClick={() => act("request_changes")} disabled={working}><RotateCcw size={15} /> Request changes</button>}
                {["in_review", "changes_requested"].includes(selected.status) && <button onClick={() => act("approve")} disabled={working}><Check size={15} /> Approve</button>}
                {["submitted", "in_review", "changes_requested"].includes(selected.status) && <button className="muted" onClick={() => act("reject")} disabled={working}><X size={15} /> Reject</button>}
                {["approved", "unpublished", "scheduled"].includes(selected.status) && <button onClick={() => act("schedule")} disabled={working}><CalendarClock size={15} /> Schedule</button>}
                {["approved", "scheduled", "unpublished"].includes(selected.status) && <button className="publish" onClick={() => act("publish")} disabled={working}>Publish now</button>}
                {["published", "scheduled"].includes(selected.status) && <button className="muted" onClick={() => act("unpublish")} disabled={working}>Unpublish</button>}
              </div>
            </article>}
          </div>}
      </section>
    </main>
  );
}
