"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Clock3, MapPin, Ticket } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { eventImageSrcSet, eventImageUrl } from "./event-images";
import type { CuratedEvent } from "./events";

type WindowFilter = "tonight" | "weekend" | "next";
type VibeFilter = CuratedEvent["vibe"] | "All";

const vibes: Array<{ value: VibeFilter; label: string; cue: string }> = [
  { value: "All", label: "Everything", cue: "No commitment yet" },
  { value: "Late night", label: "Late night", cue: "Tomorrow can wait" },
  { value: "Day party", label: "Day party", cue: "Sunglasses involved" },
  { value: "Alté", label: "Alté", cue: "Outfit understood" },
  { value: "Amapiano", label: "Amapiano", cue: "Shoes volunteered" },
];

function matchesWindow(event: CuratedEvent, filter: WindowFilter, now: number) {
  const starts = new Date(event.startsAt);
  const distance = starts.getTime() - now;
  if (filter === "tonight") return distance >= -4 * 60 * 60 * 1000 && distance <= 18 * 60 * 60 * 1000;
  if (filter === "weekend") {
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Accra" }).format(starts);
    return distance >= 0 && distance <= 7 * 24 * 60 * 60 * 1000 && ["Fri", "Sat", "Sun"].includes(weekday);
  }
  return distance >= -4 * 60 * 60 * 1000;
}

export default function EventExplorer({ events, full = false }: { events: CuratedEvent[]; full?: boolean }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("next");
  const [area, setArea] = useState("All areas");
  const [vibe, setVibe] = useState<VibeFilter>("All");
  const [page, setPage] = useState(0);
  const [position, setPosition] = useState(0);
  const [now] = useState(() => Date.now());
  const railRef = useRef<HTMLDivElement>(null);
  const pageSize = full ? 9 : 6;
  const areas = useMemo(() => ["All areas", ...new Set(events.map((event) => event.area))], [events]);
  const visible = useMemo(() => events.filter((event) => matchesWindow(event, windowFilter, now)
    && (area === "All areas" || event.area === area)
    && (vibe === "All" || event.vibe === vibe)), [area, events, now, vibe, windowFilter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageEvents = visible.slice(page * pageSize, page * pageSize + pageSize);

  function changeWindow(value: WindowFilter) {
    setWindowFilter(value);
    setPage(0);
    setPosition(0);
    railRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }

  function moveRail(direction: -1 | 1) {
    const cards = Array.from(railRef.current?.querySelectorAll<HTMLElement>(".drop-card") ?? []);
    if (!cards.length) return;
    const next = Math.max(0, Math.min(cards.length - 1, position + direction));
    cards[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    setPosition(next);
  }

  function trackRail() {
    if (full || !railRef.current) return;
    const cards = Array.from(railRef.current.querySelectorAll<HTMLElement>(".drop-card"));
    const marker = railRef.current.scrollLeft + 20;
    let next = 0;
    cards.forEach((card, index) => { if (card.offsetLeft <= marker + card.offsetWidth / 2) next = index; });
    if (next !== position) setPosition(next);
  }

  if (!events.length) {
    return <section className="event-empty"><Ticket size={28} /><h3>The Drop is having a wardrobe change.</h3><p>Nothing goes public until the Host, venue and ticket terms can survive daylight.</p><Link href="/organizer/submit">Give us a night <ArrowUpRight size={16} /></Link></section>;
  }

  return <div className={`drop-explorer${full ? " drop-explorer--full" : ""}`} data-scroll-reveal>
    <div className="drop-controls" aria-label="Filter The Drop">
      <div role="tablist" aria-label="When">
        <button type="button" role="tab" aria-selected={windowFilter === "tonight"} onClick={() => changeWindow("tonight")}>Tonight</button>
        <button type="button" role="tab" aria-selected={windowFilter === "weekend"} onClick={() => changeWindow("weekend")}>This weekend</button>
        <button type="button" role="tab" aria-selected={windowFilter === "next"} onClick={() => changeWindow("next")}>Next up</button>
      </div>
      <label><MapPin size={13} /><span className="sr-only">Area</span><select value={area} onChange={(event) => { setArea(event.target.value); setPage(0); }}>{areas.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>

    <div className="drop-vibes" role="tablist" aria-label="Choose the energy">
      {vibes.map((item) => <button key={item.value} type="button" role="tab" aria-selected={vibe === item.value} onClick={() => { setVibe(item.value); setPage(0); setPosition(0); railRef.current?.scrollTo({ left: 0, behavior: "smooth" }); }}><b>{item.label}</b><span>{item.cue}</span></button>)}
    </div>

    {!full && pageEvents.length ? <div className="drop-rail-status"><span><b>{String(position + 1).padStart(2, "0")}</b> / {String(pageEvents.length).padStart(2, "0")}</span><p>Swipe. Judge. Repeat.</p><div><button type="button" onClick={() => moveRail(-1)} disabled={position === 0} aria-label="Previous event"><ArrowLeft size={16} /></button><button type="button" onClick={() => moveRail(1)} disabled={position >= pageEvents.length - 1} aria-label="Next event"><ArrowRight size={16} /></button></div></div> : null}

    {pageEvents.length ? <div className={`drop-grid${full ? " drop-grid--full" : " drop-grid--rail"}`} aria-live="polite" ref={railRef} onScroll={trackRail}>
      {pageEvents.map((event) => <article className="drop-card" key={event.slug}>
        <Link href={`/event/${event.slug}`} className="drop-card__image">
          <img src={eventImageUrl(event.image, 720)} srcSet={eventImageSrcSet(event.image)} sizes={full ? "(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 33vw" : "(max-width: 700px) 84vw, 31vw"} alt={`Atmosphere for ${event.title}`} loading="lazy" decoding="async" />
          {event.isTestEvent ? <span>Working preview</span> : null}
          <i>{event.vibe}</i>
        </Link>
        <div className="drop-card__body">
          <p>{event.shortDate} · {event.time.split(" — ")[0]}</p>
          <h3><Link href={`/event/${event.slug}`}>{event.title}</Link></h3>
          <strong>{event.quip}</strong>
          <p className="drop-card__note">{event.note}</p>
          <small><Clock3 size={11} /> {event.lineup}</small>
          <div><span><MapPin size={12} /> {event.area}</span><span><Ticket size={12} /> From GH₵{event.price}</span></div>
          <Link href={`/event/${event.slug}`} aria-label={`See ${event.title}`}>I&apos;m listening <ArrowUpRight size={14} /></Link>
        </div>
      </article>)}
    </div> : <div className="drop-no-match"><CalendarDays size={22} /><h3>That combination is being difficult.</h3><p>Try Next up, another area or a new energy. The good night is still in here somewhere.</p></div>}

    {full && pageCount > 1 ? <nav className="drop-pagination" aria-label="Event pages"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} /> Previous</button><span>{page + 1} of {pageCount}</span><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => value + 1)}>Next <ArrowRight size={15} /></button></nav> : null}
  </div>;
}
