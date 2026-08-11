"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, MapPin, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import type { CuratedEvent } from "./events";

type WindowFilter = "tonight" | "weekend" | "next";

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
  const [page, setPage] = useState(0);
  const [now] = useState(() => Date.now());
  const pageSize = full ? 9 : 6;
  const areas = useMemo(() => ["All areas", ...new Set(events.map((event) => event.area))], [events]);
  const visible = useMemo(() => events.filter((event) => matchesWindow(event, windowFilter, now) && (area === "All areas" || event.area === area)), [area, events, now, windowFilter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageEvents = visible.slice(page * pageSize, page * pageSize + pageSize);

  function changeWindow(value: WindowFilter) {
    setWindowFilter(value);
    setPage(0);
  }

  if (!events.length) {
    return <section className="event-empty"><Ticket size={28} /><h3>The next Drop is still being checked.</h3><p>Nothing is published until the Host, venue and ticket terms are ready.</p><Link href="/organizer/submit">Submit a night <ArrowUpRight size={16} /></Link></section>;
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

    {pageEvents.length ? <div className="drop-grid" aria-live="polite">
      {pageEvents.map((event) => <article className="drop-card" key={event.slug}>
        <Link href={`/event/${event.slug}`} className="drop-card__image">
          <img src={event.image} alt={`Atmosphere for ${event.title}`} />
          {event.isTestEvent ? <span>Working preview</span> : null}
        </Link>
        <div className="drop-card__body">
          <p>{event.shortDate} · {event.time.split(" — ")[0]}</p>
          <h3><Link href={`/event/${event.slug}`}>{event.title}</Link></h3>
          <div><span><MapPin size={12} /> {event.area}</span><span><Ticket size={12} /> From GH₵{event.price}</span></div>
          <Link href={`/event/${event.slug}`} aria-label={`See ${event.title}`}>See the night <ArrowUpRight size={14} /></Link>
        </div>
      </article>)}
    </div> : <div className="drop-no-match"><CalendarDays size={22} /><h3>Nothing in that window yet.</h3><p>Try Next up or another area. We only show nights that have passed the checks.</p></div>}

    {full && pageCount > 1 ? <nav className="drop-pagination" aria-label="Event pages"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} /> Previous</button><span>{page + 1} of {pageCount}</span><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => value + 1)}>Next <ArrowRight size={15} /></button></nav> : null}
  </div>;
}
