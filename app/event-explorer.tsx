"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, MapPin, Shuffle, Ticket } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { CuratedEvent } from "./events";

const vibes = [
  ["All", "All events"],
  ["Late night", "After midnight"],
  ["Day party", "Sun first"],
  ["Alté", "Look expensive"],
  ["Amapiano", "Dance, obviously"],
] as const;

export default function EventExplorer({ events }: { events: CuratedEvent[] }) {
  const [active, setActive] = useState("All");
  const [picked, setPicked] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () => active === "All" ? events : events.filter((event) => event.vibe === active),
    [active, events]
  );

  if (!events.length) {
    return <section className="event-empty"><Ticket size={28} /><h3>The next drop is still being checked.</h3><p>Nothing is published until the organiser, venue and ticket terms are ready for customers.</p><Link href="/organizer/submit">Submit a party <ArrowUpRight size={16} /></Link></section>;
  }

  function chooseForMe() {
    if (!visible.length) return;
    const pool = visible.filter((event) => event.slug !== picked);
    const event = pool[Math.floor(Math.random() * pool.length)] ?? visible[0];
    setPicked(event.slug);
    window.setTimeout(() => {
      document.getElementById(`party-${event.slug}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 80);
  }

  function selectVibe(value: string) {
    setActive(value);
    setPicked(null);
    setPosition(0);
    railRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }

  function moveRail(direction: -1 | 1) {
    const cards = Array.from(railRef.current?.querySelectorAll<HTMLElement>(".curated-card") ?? []);
    if (!cards.length) return;
    const next = Math.max(0, Math.min(cards.length - 1, position + direction));
    cards[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setPosition(next);
  }

  function trackRail() {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>(".curated-card"));
    const centre = rail.scrollLeft + rail.clientWidth / 2;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const cardCentre = card.offsetLeft + card.offsetWidth / 2;
      const nextDistance = Math.abs(cardCentre - centre);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    if (closest !== position) setPosition(closest);
  }

  return (
    <>
      <div className="night-finder" aria-label="Find a party by mood" data-scroll-reveal>
        <div className="night-finder__question">
          <span>What are we feeling?</span>
          <button type="button" onClick={chooseForMe} className="night-shuffle">
            <Shuffle size={14} /> {picked ? "Try me again" : "Choose for me"}
          </button>
        </div>
        <div className="vibe-filter" role="tablist" aria-label="Party atmosphere">
          {vibes.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active === value}
              className={active === value ? "active" : ""}
              onClick={() => selectVibe(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="night-finder__answer" aria-live="polite">
          {picked ? `Fine. ${events.find((event) => event.slug === picked)?.title}. Don’t overthink it.` : "We narrowed Accra down. You’re welcome."}
        </p>
      </div>

      <div className="event-rail-status" aria-label="Event carousel position" data-scroll-reveal>
        <span><b>{String(position + 1).padStart(2, "0")}</b> / {String(visible.length).padStart(2, "0")}</span>
        <p>Swipe the edit</p>
        <div>
          <button type="button" onClick={() => moveRail(-1)} disabled={position === 0} aria-label="Previous event"><ArrowLeft size={17} /></button>
          <button type="button" onClick={() => moveRail(1)} disabled={position >= visible.length - 1} aria-label="Next event"><ArrowRight size={17} /></button>
        </div>
      </div>

      <div id="event-rail" className="curated-grid" aria-live="polite" ref={railRef} onScroll={trackRail} data-scroll-reveal data-reveal-delay="1">
        {visible.map((event, index) => (
          <article
            id={`party-${event.slug}`}
            className={`${index === 0 && active === "All" ? "curated-card curated-card--lead" : "curated-card"}${picked === event.slug ? " is-picked" : ""}`}
            key={event.slug}
          >
            <Link href={`/event/${event.slug}`} className="curated-card__image">
              <img src={event.image} alt={`Atmosphere for ${event.title}`} />
              <span className="curated-card__number">{event.sequence}</span>
              {event.isTestEvent ? <span className="curated-card__preview">Preview event</span> : null}
              <span className="curated-card__vibe">{event.vibe}</span>
              <span className="curated-card__overlay">
                <small>{event.shortDate} · {event.time.split(" — ")[0]}</small>
                <strong>{event.title}</strong>
                <i>{event.venue} · {event.area}</i>
              </span>
            </Link>
            <div className="curated-card__body">
              <p>{event.quip}</p>
              <div className="curated-card__meta" aria-label="Party details">
                <span><MapPin size={12} /> {event.area}</span>
                <span><Clock3 size={12} /> {event.time.split(" — ")[0]}</span>
                <span><Ticket size={12} /> GH₵{event.price}</span>
              </div>
              <Link href={`/event/${event.slug}`} className="curated-card__link" aria-label={`View ${event.title}`}>
                I&apos;m listening <ArrowUpRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
