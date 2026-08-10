"use client";

import Link from "next/link";
import { CalendarClock, Check, ChevronRight, Eye, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Submission = {
  id: string; organizerName: string; contactName: string; contactEmail: string; contactPhone: string;
  title: string; concept: string; venueName: string; area: string; startsAt: string; endsAt: string;
  vibe: string; lineup: string; capacity: number; priceFromMinor: number; ageRestriction: string;
  posterObjectKey: string | null; status: string; reviewNote: string | null; curationNote: string | null;
  scheduledPublishAt: string | null; eventSlug: string | null; createdAt: string;
};

const labels: Record<string, string> = { submitted: "New", in_review: "In review", changes_requested: "Changes requested", approved: "Approved", rejected: "Rejected", scheduled: "Scheduled", published: "Published", unpublished: "Unpublished", archived: "Archived" };

export default function CurationDesk({ actor }: { actor: string }) {
  const [items, setItems] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [curationNote, setCurationNote] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const applyLoadedItems = useCallback((submissions: Submission[]) => {
    setItems(submissions);
    setSelectedId((current) => {
      if (current) return current;
      const first = submissions[0];
      if (first) {
        setNote(first.reviewNote ?? "");
        setCurationNote(first.curationNote ?? "");
        setScheduledAt(first.scheduledPublishAt?.slice(0, 16) ?? "");
      }
      return first?.id ?? null;
    });
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/submissions", { cache: "no-store" });
    const result = await response.json() as { submissions?: Submission[]; error?: string };
    if (!response.ok) { setError(result.error ?? "Could not load the curation queue."); setLoading(false); return; }
    applyLoadedItems(result.submissions ?? []);
    setLoading(false);
  }, [applyLoadedItems]);

  useEffect(() => {
    fetch("/api/admin/submissions", { cache: "no-store" })
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
    setScheduledAt(item.scheduledPublishAt?.slice(0, 16) ?? "");
    setError("");
  }

  async function act(action: string) {
    if (!selected) return;
    setWorking(true); setError("");
    const response = await fetch("/api/admin/submissions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, action, note, curationNote, scheduledPublishAt: scheduledAt }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "The review action failed.");
    else await load();
    setWorking(false);
  }

  return (
    <main className="curation-page">
      <aside className="curation-nav">
        <Link href="/" className="night-brand-link"><span className="night-brand"><b>B</b><span>BeCore<br />Tickets</span></span></Link>
        <nav><span>Curation</span><Link className="active" href="/admin">Submission queue</Link><Link href="/admin/rooms">Room moderation</Link><Link href="/admin/fees">Fees & charges</Link><Link href="/organizer">Organiser view</Link></nav>
        <p><ShieldCheck size={14} /> Restricted<br /><small>{actor}</small></p>
      </aside>
      <section className="curation-main">
        <header><div><p>BeCore editorial operations</p><h1>Curation queue</h1></div><span>{items.filter((item) => item.status === "submitted").length} waiting</span></header>
        {loading ? <div className="curation-empty"><Loader2 className="spin" /> Loading submissions…</div> : items.length === 0 ? <div className="curation-empty"><h2>Quiet queue. Suspiciously quiet.</h2><p>New organiser submissions will appear here for review.</p><Link href="/organizer/submit">Open submission form</Link></div> : (
          <div className="curation-workspace">
            <div className="curation-list">
              {items.map((item) => <button key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => selectItem(item)}><span className={`review-status ${item.status}`}>{labels[item.status] ?? item.status}</span><b>{item.title}</b><small>{item.organizerName} · {item.area}</small><time>{new Date(item.startsAt).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}</time><ChevronRight size={16} /></button>)}
            </div>
            {selected && <article className="curation-detail">
              <div className="curation-detail__head"><div><span className={`review-status ${selected.status}`}>{labels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.organizerName} · submitted {new Date(selected.createdAt).toLocaleDateString("en-GH")}</p></div>{selected.posterObjectKey && <img src={`/api/media/${selected.id}`} alt={`${selected.title} poster`} />}</div>
              <div className="curation-facts"><span><small>When</small>{new Date(selected.startsAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</span><span><small>Where</small>{selected.venueName}, {selected.area}</span><span><small>Commercial</small>GH₵{(selected.priceFromMinor / 100).toFixed(0)} · {selected.capacity} guests</span><span><small>Audience</small>{selected.ageRestriction} · {selected.vibe}</span></div>
              <section><h3>The pitch</h3><p>{selected.concept}</p></section>
              <section><h3>Line-up</h3><p>{selected.lineup}</p></section>
              <section><h3>Contact</h3><p>{selected.contactName} · {selected.contactEmail} · {selected.contactPhone}</p></section>
              <label>Why it made the list<textarea value={curationNote} onChange={(event) => setCurationNote(event.target.value)} placeholder="Customer-facing editorial note. Keep it specific and useful." /></label>
              <label>Private / organiser note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain requested changes or rejection clearly." /></label>
              <label>Publication time<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
              {error && <p className="curation-error" role="alert">{error}</p>}
              <div className="curation-actions">
                {selected.status === "submitted" && <button onClick={() => act("start_review")} disabled={working}><Eye size={15} /> Start review</button>}
                {["submitted", "in_review", "approved"].includes(selected.status) && <button onClick={() => act("request_changes")} disabled={working}><RotateCcw size={15} /> Request changes</button>}
                {["in_review", "changes_requested"].includes(selected.status) && <button onClick={() => act("approve")} disabled={working}><Check size={15} /> Approve</button>}
                {["submitted", "in_review", "changes_requested"].includes(selected.status) && <button className="muted" onClick={() => act("reject")} disabled={working}><X size={15} /> Reject</button>}
                {["approved", "unpublished", "scheduled"].includes(selected.status) && <button onClick={() => act("schedule")} disabled={working}><CalendarClock size={15} /> Schedule</button>}
                {["approved", "scheduled", "unpublished"].includes(selected.status) && <button className="publish" onClick={() => act("publish")} disabled={working}>Publish now</button>}
                {["published", "scheduled"].includes(selected.status) && <button className="muted" onClick={() => act("unpublish")} disabled={working}>Unpublish</button>}
              </div>
            </article>}
          </div>
        )}
      </section>
    </main>
  );
}
