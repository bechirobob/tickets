"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, MapPin, Search, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import { eventImageLoader } from "./event-images";
import type { CuratedEvent } from "./events";
import { matchesEventWindow, type EventWindow } from "../lib/event-discovery";
import { discoveryPrice } from "../lib/event-pricing";

type WindowFilter = EventWindow;
type VibeFilter = CuratedEvent["vibe"] | "All";

const vibes: Array<{ value: VibeFilter; label: string }> = [
  { value: "All", label: "All music & moods" },
  { value: "Late night", label: "Late night" },
  { value: "Day party", label: "Day party" },
  { value: "Alté", label: "Alté" },
  { value: "Amapiano", label: "Amapiano" },
];

export default function EventExplorer({ events, full = false, featuredSlug }: { events: CuratedEvent[]; full?: boolean; featuredSlug?: string }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("next");
  const [area, setArea] = useState("All areas");
  const [vibe, setVibe] = useState<VibeFilter>("All");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [now] = useState(() => Date.now());
  const pageSize = full ? 12 : 6;
  const areas = useMemo(() => ["All areas", ...new Set(events.map((event) => event.area))], [events]);
  const visible = useMemo(() => events.filter((event) => matchesEventWindow(event, windowFilter, now)
    && (area === "All areas" || event.area === area)
    && (vibe === "All" || event.vibe === vibe)
    && `${event.title} ${event.venue} ${event.area} ${event.lineup}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [area, events, now, search, vibe, windowFilter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageEvents = visible.slice(page * pageSize, page * pageSize + pageSize);

  function changeWindow(value: WindowFilter) {
    setWindowFilter(value);
    setPage(0);
  }

  if (!events.length) {
    return <section className="event-empty"><Ticket size={28} /><h3>New nights are on the way.</h3><p>Check back for the next selection of reviewed events in Accra.</p><Link href="/organizer/submit">Submit an event <ArrowUpRight size={16} /></Link></section>;
  }

  return <div className={`drop-explorer discovery-explorer${full ? " drop-explorer--full" : ""}`}>
    {full ? <label className="discovery-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search events, artists or venues</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search events, artists or venues" /></label> : null}
    <div className="drop-controls" aria-label="Filter The Drop">
      <div role="group" aria-label="When">
        <button type="button" aria-pressed={windowFilter === "tonight"} onClick={() => changeWindow("tonight")}>Tonight</button>
        <button type="button" aria-pressed={windowFilter === "weekend"} onClick={() => changeWindow("weekend")}>This weekend</button>
        <button type="button" aria-pressed={windowFilter === "next"} onClick={() => changeWindow("next")}>Next up</button>
      </div>
      <label><MapPin size={13} /><span className="sr-only">Area</span><select value={area} onChange={(event) => { setArea(event.target.value); setPage(0); }}>{areas.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>

    <div className="drop-vibes" role="group" aria-label="Music and mood">
      {vibes.map((item) => <button key={item.value} type="button" aria-pressed={vibe === item.value} onClick={() => { setVibe(item.value); setPage(0); }}><b>{item.label}</b></button>)}
    </div>

    <p className="discovery-result-count" role="status">{visible.length} {visible.length === 1 ? "night" : "nights"}{area !== "All areas" ? ` in ${area}` : " in Accra"} · Prices include fees{events.every((event) => event.isTestEvent) ? " · Preview listings" : ""}</p>

    {pageEvents.length ? <div className={`drop-grid discovery-grid${full ? " drop-grid--full" : ""}`} data-count={pageEvents.length}>
      {pageEvents.map((event) => <article className="drop-card" key={event.slug} data-vibe={event.vibe} data-event-slug={event.slug} data-featured={event.slug === featuredSlug ? "true" : undefined}>
        <Link href={`/event/${event.slug}`} className="drop-card__image">
          <Image loader={eventImageLoader} src={event.image} width={720} height={900} sizes="(max-width: 700px) 50vw, (max-width: 1000px) 33vw, 25vw" alt={`${event.isTestEvent ? "Preview image" : "Artwork"} for ${event.title}`} />
          {event.isTestEvent ? <span>Preview</span> : null}
          {event.isTestEvent ? <div className="event-artwork-type" aria-hidden="true"><small>{event.area} · Accra</small><b>{event.title}</b><em>{event.vibe}</em></div> : null}
        </Link>
        <div className="drop-card__body">
          <p><time dateTime={event.startsAt}>{event.day.slice(0, 3)} {event.shortDate}</time> · {event.time.split(" — ")[0]}</p>
          <h3><Link href={`/event/${event.slug}`}>{event.title}</Link></h3>
          <small>{event.venue} · {event.area}</small>
          <div><span>{event.ticketTiers.some((tier) => tier.status === "available") ? `From GH₵${discoveryPrice(event)}` : event.eventState === "sold_out" ? "Sold out" : event.ticketTiers.some((tier) => tier.status === "upcoming") ? "Sales soon" : "Sales closed"}</span></div>
          <Link href={`/event/${event.slug}`} aria-label={`See ${event.title}`}>View event <ArrowUpRight size={14} /></Link>
        </div>
      </article>)}
    </div> : <div className="drop-no-match"><CalendarDays size={22} /><h3>No nights match those filters.</h3><p>Try another date, area or music style.</p><button type="button" onClick={() => { setWindowFilter("next"); setArea("All areas"); setVibe("All"); setSearch(""); setPage(0); }}>Clear filters</button></div>}

    {full && pageCount > 1 ? <nav className="drop-pagination" aria-label="Event pages"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} /> Previous</button><span>{page + 1} of {pageCount}</span><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => value + 1)}>Next <ArrowRight size={15} /></button></nav> : null}
  </div>;
}
