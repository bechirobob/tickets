"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, MapPin, Shuffle, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import type { CuratedEvent } from "./events";

const vibes = [
  ["All", "All four"],
  ["Late night", "After midnight"],
  ["Day party", "Sun first"],
  ["Alté", "Look expensive"],
  ["Amapiano", "Dance, obviously"],
] as const;

export default function EventExplorer({ events }: { events: CuratedEvent[] }) {
  const [active, setActive] = useState("All");
  const [picked, setPicked] = useState<string | null>(null);
  const visible = useMemo(
    () => active === "All" ? events : events.filter((event) => event.vibe === active),
    [active, events]
  );

  function chooseForMe() {
    if (!visible.length) return;
    const pool = visible.filter((event) => event.slug !== picked);
    const event = pool[Math.floor(Math.random() * pool.length)] ?? visible[0];
    setPicked(event.slug);
    window.setTimeout(() => {
      document.getElementById(`party-${event.slug}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  return (
    <>
      <div className="night-finder" aria-label="Find a party by mood">
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
              onClick={() => { setActive(value); setPicked(null); }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="night-finder__answer" aria-live="polite">
          {picked ? `Fine. ${events.find((event) => event.slug === picked)?.title}. Don’t overthink it.` : "We narrowed Accra down. You’re welcome."}
        </p>
      </div>

      <div className="curated-grid" aria-live="polite">
        {visible.map((event, index) => (
          <article
            id={`party-${event.slug}`}
            className={`${index === 0 && active === "All" ? "curated-card curated-card--lead" : "curated-card"}${picked === event.slug ? " is-picked" : ""}`}
            key={event.slug}
          >
            <Link href={`/event/${event.slug}`} className="curated-card__image">
              <img src={event.image} alt={`Atmosphere for ${event.title}`} />
              <span className="curated-card__number">{event.sequence}</span>
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
