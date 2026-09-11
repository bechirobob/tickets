"use client";

import { useDiscoveryState } from "./discovery-state";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, MapPin, Search, Ticket } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { useCurrentTime } from "./use-current-time";
import { eventImageLoader, eventImageUrl } from "./event-images";
import type { CustomerEvent } from "../lib/customer-screen";
import { matchesEventWindow, type EventWindow } from "../lib/event-discovery";
import { ActionLink } from "./action";
import { discoveryOffer } from "../lib/event-pricing";
import PosterLink from "./poster-link";
import { eventColourScheme, eventPresentationStyle } from "../lib/event-presentation";

type WindowFilter = EventWindow;
type VibeFilter = CustomerEvent["vibe"] | "All";

const subscribeToClient = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

const vibes: Array<{ value: VibeFilter; label: string }> = [
  { value: "All", label: "All music & moods" },
  { value: "Late night", label: "Late night" },
  { value: "Day party", label: "Day party" },
  { value: "Alté", label: "Alté" },
  { value: "Amapiano", label: "Amapiano" },
];

export default function EventExplorer({ events, full = false, featuredSlug }: { events: CustomerEvent[]; full?: boolean; featuredSlug?: string }) {
  // SSR can appear before React attaches handlers. Do not accept and lose input.
  const ready = useSyncExternalStore(subscribeToClient, clientReady, serverReady);
  const { windowFilter, selectedDate, area, vibe, page, search, setWindowFilter, setSelectedDate, setArea, setVibe, setPage, setSearch } = useDiscoveryState(full);
  const now = useCurrentTime();
  const pageSize = full ? 12 : 6;
  const areas = useMemo(() => ["All areas", ...new Set(events.map((event) => event.area))], [events]);
  const visible = useMemo(() => events.filter((event) => matchesEventWindow(event, windowFilter, now, selectedDate)
    && (area === "All areas" || event.area === area)
    && (vibe === "All" || event.vibe === vibe)
    && `${event.title} ${event.venue} ${event.area} ${event.lineup}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity)), [area, events, now, search, selectedDate, vibe, windowFilter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageEvents = visible.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  function changeWindow(value: WindowFilter) {
    setWindowFilter(value);
    setPage(0);
  }

  if (!events.length) {
    return <section className="event-empty"><Ticket size={28} /><h3>The next plan is still cooking.</h3><p>New Accra nights will land here once they’ve been reviewed. Got one worth going out for?</p><Link href="/organizer/submit">Submit an event <ArrowUpRight size={16} /></Link></section>;
  }

  return <div className={`drop-explorer discovery-explorer${full ? " drop-explorer--full" : ""}`}>
    {full ? <label className="discovery-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search events, artists or venues</span><input type="search" disabled={!ready} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search events, artists or venues" /></label> : null}
    <div className="drop-controls" aria-label="Filter The Drop">
      <div role="group" aria-label="When">
        <button type="button" disabled={!ready} aria-pressed={windowFilter === "tonight"} onClick={() => changeWindow("tonight")}>Tonight</button>
        <button type="button" disabled={!ready} aria-pressed={windowFilter === "tomorrow"} onClick={() => changeWindow("tomorrow")}>Tomorrow</button>
        <button type="button" disabled={!ready} aria-pressed={windowFilter === "weekend"} onClick={() => changeWindow("weekend")}>This weekend</button>
        <button type="button" disabled={!ready} aria-pressed={windowFilter === "next"} onClick={() => changeWindow("next")}>Next up</button>
      </div>
      {full ? <label className="discovery-date"><CalendarDays size={16} aria-hidden="true" /><span>Pick a date</span><input type="date" disabled={!ready} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label> : null}
      <label><MapPin size={13} /><span className="sr-only">Area</span><select disabled={!ready} value={area} onChange={(event) => { setArea(event.target.value); setPage(0); }}>{areas.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>

    <div className="drop-vibes" role="group" aria-label="Music and mood">
      {vibes.map((item) => <button key={item.value} type="button" disabled={!ready} aria-pressed={vibe === item.value} onClick={() => { setVibe(item.value); setPage(0); }}><b>{item.label}</b></button>)}
    </div>

    <p className="discovery-result-count" role="status">{visible.length} {visible.length === 1 ? "night" : "nights"}{area !== "All areas" ? ` in ${area}` : " in Accra"}{events.every((event) => event.isTestEvent) ? " · Preview listings" : ""}</p>

    {pageEvents.length ? <div key={`${windowFilter}:${selectedDate}:${area}:${vibe}:${currentPage}:${search}`} className={`drop-grid discovery-grid${full ? " drop-grid--full" : ""}`} data-count={pageEvents.length}>
      {pageEvents.map((event) => <article className="drop-card" key={event.slug} data-vibe={event.vibe} data-event-slug={event.slug} data-colour-scheme={eventColourScheme(event)} style={eventPresentationStyle(event)} data-featured={event.slug === featuredSlug ? "true" : undefined}>
        <PosterLink href={`/event/${event.slug}`} className="drop-card__image">
          <div className="drop-card__artwork-wash" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(eventImageUrl(event.image, 96, 25))})` }} />
          <Image loader={eventImageLoader} src={event.image} width={720} height={900} sizes="(max-width: 700px) 50vw, (max-width: 1000px) 33vw, 25vw" alt={`${event.isTestEvent ? "Preview image" : "Artwork"} for ${event.title}`} />
          {event.isTestEvent ? <span>Preview</span> : null}
          {event.isTestEvent ? <div className="event-artwork-type" aria-hidden="true"><small>{event.area} · Accra</small><b>{event.title}</b><em>{event.vibe}</em></div> : null}
        </PosterLink>
        <div className="drop-card__body">
          <p className="drop-card__schedule">{event.startsAt ? <><time dateTime={event.startsAt}>{event.day.slice(0, 3)} {event.shortDate}</time> · {event.time.split(" — ")[0]}</> : "Coming soon"}</p>
          <h3><Link href={`/event/${event.slug}`}>{event.title}</Link></h3>
          <small>{event.venue} · {event.area}</small>
          <p className="drop-card__quip" aria-hidden={event.quip ? undefined : true}>{event.quip}</p>
          <div><span>{discoveryOffer(event).label}</span></div><p className="drop-card__verification" aria-hidden={event.isVerified ? undefined : true}>{event.isVerified ? <span className="drop-card__verified"><BadgeCheck size={13} aria-hidden="true" /> Verified event</span> : null}</p>
          <ActionLink href={`/event/${event.slug}`} variant="text" aria-label={`See ${event.title}`}>View event</ActionLink>
        </div>
      </article>)}
    </div> : <div className="drop-no-match"><CalendarDays size={22} /><h3>Even Accra has a quiet corner.</h3><p>No nights match just yet. Try another date, area or music style.</p><button type="button" onClick={() => { setWindowFilter("next"); setArea("All areas"); setVibe("All"); setSearch(""); setPage(0); }}>Clear filters</button></div>}

    {full && pageCount > 1 ? <nav className="drop-pagination" aria-label="Event pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={15} /> Previous</button><span>{currentPage + 1} of {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next <ArrowRight size={15} /></button></nav> : null}
  </div>;
}
