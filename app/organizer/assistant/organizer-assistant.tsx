"use client";

import BrandLogo from "../../brand-logo";
import WorkspaceJump from "../../admin/workspace-jump";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUp, BadgeCheck, Loader2, LogOut } from "lucide-react";
import type { StaffRole } from "../../../lib/admin-session";
import styles from "./assistant.module.css";

type EventOption = {
  slug: string;
  title: string;
  startsAt: string;
  eventState: string;
};

type Exchange = {
  id: string;
  question: string;
  answer: string;
};

const prompts = [
  "What needs attention right now?",
  "How are ticket sales looking?",
  "Are we ready for entry?",
  "Summarise the latest settlement position.",
];

const date = (value: string) => new Date(value).toLocaleDateString("en-GH", { dateStyle: "medium" });
const readable = (value: string) => value.replaceAll("_", " ");

export default function OrganizerAssistant({ actor, role }: { actor: string; role: StaffRole }) {
  const router = useRouter();
  const search = useSearchParams();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/organizer/assistant/events", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, result: await response.json() as { events?: EventOption[]; error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) throw new Error(result.error ?? "Your events could not be loaded.");
        const nextEvents = result.events ?? [];
        setEvents(nextEvents);
        const requested = search.get("event");
        setSelectedSlug(nextEvents.some((event) => event.slug === requested) ? requested ?? "" : nextEvents[0]?.slug ?? "");
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Your events could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search]);

  const selected = useMemo(() => events.find((event) => event.slug === selectedSlug) ?? null, [events, selectedSlug]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!selectedSlug || text.length < 2 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/organizer/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventSlug: selectedSlug, message: text }),
      });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !result.answer) throw new Error(result.error ?? "The event desk could not answer that.");
      setHistory((items) => [{ id: crypto.randomUUID(), question: text, answer: result.answer! }, ...items].slice(0, 6));
      setQuestion("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The event desk could not answer that.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <Link href="/" className="night-brand-link"><BrandLogo /></Link>
      <WorkspaceJump active="/organizer/assistant" role={role} compact />
      <div className={styles.account}><span><BadgeCheck size={15} /> {actor}</span><button type="button" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
    </header>

    <section className={styles.intro}>
      <div><p>Organiser workspace</p><h1>Event desk</h1></div>
      <span>Ask about sales, entry, ticket tiers, settlements or what needs attention.</span>
    </section>

    {loading ? <section className={styles.loading}><Loader2 className="spin" size={18} /> Loading your Nights…</section> : events.length === 0 ? <section className={styles.empty}><h2>No approved Nights yet.</h2><p>The event desk becomes available once an event is approved.</p><Link href="/organizer/submit">Submit an event</Link></section> : <>
      <section className={styles.selector}>
        <label htmlFor="assistant-event">Night</label>
        <select id="assistant-event" value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setHistory([]); setError(""); }}>
          {events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}
        </select>
        {selected ? <span>{date(selected.startsAt)} · {readable(selected.eventState)}</span> : null}
      </section>

      <section className={styles.workspace}>
        <div className={styles.promptArea}>
          <div className={styles.quickPrompts} aria-label="Suggested questions">
            {prompts.map((prompt) => <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}</button>)}
          </div>
          <form onSubmit={ask} className={styles.askForm}>
            <label htmlFor="event-desk-question">Ask about {selected?.title ?? "this Night"}</label>
            <div><textarea id="event-desk-question" value={question} onChange={(event) => setQuestion(event.target.value)} minLength={2} maxLength={1500} placeholder="What should I be watching before doors open?" required /><button type="submit" aria-label="Ask event desk" disabled={busy || question.trim().length < 2}>{busy ? <Loader2 className="spin" size={18} /> : <ArrowUp size={19} />}</button></div>
          </form>
          <p className={styles.boundary}>Read-only. It can explain your event data and recommend next steps, but it cannot change tickets, payments, permissions or event settings.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>

        <div className={styles.answers} aria-live="polite">
          {history.length ? history.map((item) => <article key={item.id}><small>You asked</small><h2>{item.question}</h2><div>{item.answer.split("\n").map((line, index) => line.trim() ? <p key={`${item.id}-${index}`}>{line}</p> : null)}</div></article>) : <div className={styles.firstAnswer}><span>Event desk</span><h2>{selected?.title}</h2><p>Choose a question above or ask your own. The answer uses the current BeCore Tickets record for this Night.</p></div>}
        </div>
      </section>
    </>}
  </main>;
}
