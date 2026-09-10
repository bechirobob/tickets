"use client";

import { useEffect, useState } from "react";
import type { EventState } from "../../../lib/customer-screen";

export default function EventCountdown({ startsAt, endsAt, eventState, isPreview }: {
  startsAt: string | null; endsAt: string | null; eventState: EventState; isPreview: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!startsAt || eventState === "cancelled" || eventState === "postponed") return null;
  const seconds = now === null ? null : Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 1000));
  if (seconds === 0 && now !== null) return <p className="event-countdown-state">{endsAt && now >= Date.parse(endsAt) ? "Event ended" : !endsAt ? "Doors have opened" : isPreview ? "Preview in progress" : "Happening now"}</p>;
  const units = [
    { label: "Days", value: Math.floor((seconds ?? 0) / 86400) },
    { label: "Hours", value: Math.floor((seconds ?? 0) / 3600) % 24 },
    { label: "Mins", value: Math.floor((seconds ?? 0) / 60) % 60 },
    { label: "Secs", value: (seconds ?? 0) % 60 },
  ];
  return <div className="event-countdown"><p>{isPreview ? "Preview starts in" : "Event starts in"}</p><div role="timer" aria-live="off" aria-label={seconds === null ? "Loading countdown" : units.map(({ label, value }) => `${value} ${label.toLowerCase()}`).join(", ")}>{units.map(({ label, value }) => <span key={label}><b>{seconds === null ? "– –" : String(value).padStart(2, "0")}</b><small>{label}</small></span>)}</div></div>;
}
