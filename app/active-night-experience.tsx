"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BatteryFull,
  Camera,
  ConciergeBell,
  Gem,
  LockKeyhole,
  Send,
  Signal,
  Ticket,
  Wifi,
} from "lucide-react";
import type { CSSProperties, FocusEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import EventExplorer from "./event-explorer";
import { eventImageUrl } from "./event-images";
import type { CuratedEvent } from "./events";
import RoomPreviewCarousel from "./room-preview-carousel";
import { discoveryPrice } from "../lib/event-pricing";

const sceneInterval = 4_500;
const fallbackImage = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88";

const sceneThemes: Record<CuratedEvent["vibe"], { acid: string; signal: string; bone: string; dark: string }> = {
  "Late night": { acid: "#d7f45b", signal: "#bd3f11", bone: "#f1eee6", dark: "#10110f" },
  "Day party": { acid: "#f0d36d", signal: "#a94718", bone: "#f4efe2", dark: "#16130d" },
  "Alté": { acid: "#c8d9f2", signal: "#a74432", bone: "#edf0ef", dark: "#101216" },
  "Amapiano": { acid: "#e2c9eb", signal: "#963d50", bone: "#f2ecee", dark: "#151014" },
};

function HostUpdate({ label, time, dateTime, title, detail, compact = false }: { label: string; time: string; dateTime: string; title: string; detail: string; compact?: boolean }) {
  return <article className={`scene-host${compact ? " scene-host--compact" : ""}`}>
    <span className="scene-host__mark" aria-hidden="true"><BadgeCheck size={14} /></span>
    <div className="scene-host__content">
      <header><small>{label}</small><time dateTime={dateTime}>{time}</time></header>
      <p><strong>{title}</strong> <span>{detail}</span></p>
    </div>
  </article>;
}

function RoomPhone({ event, heroImage, conversation }: { event: CuratedEvent | null; heroImage: string; conversation: "arrival" | "inside" }) {
  const eventTitle = event?.title ?? "After Dark";
  const area = event?.area ?? "Osu";
  const venue = event?.venue ?? "the venue";
  const startTime = event?.time.split(" — ")[0] ?? "9:00 PM";

  return <article className={`room-product-phone room-product-phone--${conversation}`} role="group" aria-roledescription="slide" aria-label={conversation === "arrival" ? "Before arrival, 1 of 2" : "Inside the night, 2 of 2"}>
    <Image className="room-product-phone__render" src="/devices/iphone-black-titanium.png" width={1024} height={1536} alt="" aria-hidden="true" unoptimized />
    <div className="room-product-phone__display">
    <div className="room-product-phone__hardware" aria-hidden="true"><span>9:2{conversation === "arrival" ? "1" : "4"}</span><i /><b><Signal size={9} /><span>5G</span><Wifi size={10} /><BatteryFull size={13} /></b></div>
    <div className="room-product-phone__screen">
      <header className="room-product-phone__header"><div><small>The Room</small><b>{eventTitle}</b></div><span>Demo chat</span></header>
      <div className="room-product-phone__stream">
        {conversation === "arrival" ? <>
          <HostUpdate label="HOST UPDATE" time="9:14 PM" dateTime="21:14" title={`Doors at ${startTime}.`} detail="Have your ticket ready at entry." />
          <article className="scene-message"><span>KM</span><div className="scene-message__body"><small className="scene-message__meta">Kofi · 9:18 PM</small><div className="scene-message__bubble"><p>Who is actually in {area} already?</p></div><div className="scene-message__reactions" aria-label="4 laughing reactions"><i>😂</i><b>4</b></div></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 9:19 PM</small><div className="scene-message__bubble"><p>“Five minutes away” in the spiritual sense.</p></div><div className="scene-message__reactions" aria-label="2 crying reactions"><i>😭</i><b>2</b></div></div></article>
          <article className="scene-message"><span>YA</span><div className="scene-message__body"><small className="scene-message__meta">Yaw · 9:22 PM</small><div className="scene-message__bubble"><p>Okay fine. Leaving now.</p></div><div className="scene-message__reactions" aria-label="3 fire reactions"><i>🔥</i><b>3</b></div></div></article>
          <article className="scene-message"><span>SE</span><div className="scene-message__body"><small className="scene-message__meta">Sena · 9:24 PM</small><div className="scene-message__bubble"><p>Outside {venue}. Queue is moving.</p></div><div className="scene-message__reactions" aria-label="2 raised hands reactions"><i>🙌</i><b>2</b></div></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 9:25 PM</small><div className="scene-message__bubble"><p>Save me a spot on the left.</p></div></div></article>
        </> : <>
          <article className="scene-message"><span>AM</span><div className="scene-message__body"><small className="scene-message__meta">Ama <b className="scene-vip-badge" title="VIP ticket holder"><Gem size={10} aria-hidden="true" /><span className="sr-only">VIP ticket holder</span></b> · 10:42 PM</small><div className="scene-message__bubble"><p>{event?.vibe ?? "Front left"} is the move tonight.</p></div><div className="scene-message__reactions" aria-label="6 watching reactions"><i>👀</i><b>6</b></div></div></article>
          <article className="scene-flash"><Image src={eventImageUrl(heroImage, 520)} width={520} height={320} sizes="260px" alt={`Flash shared inside the Room for ${eventTitle}`} unoptimized /><div><span><Camera size={12} /> Ama dropped a Flash</span><small>Gone when the Room closes</small></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 10:44 PM</small><div className="scene-message__bubble"><p>Found you. This set is ridiculous.</p></div><div className="scene-message__reactions" aria-label="5 fire reactions"><i>🔥</i><b>5</b></div></div></article>
          <HostUpdate label="HOST UPDATE" time="10:47 PM" dateTime="22:47" title="Gate change." detail="Use Gate 2 for last entry." compact />
          <article className="scene-message"><span>KM</span><div className="scene-message__body"><small className="scene-message__meta">Kofi · 10:48 PM</small><div className="scene-message__bubble"><p>Gate 2 is definitely quicker.</p></div></div></article>
          <article className="scene-message"><span>SE</span><div className="scene-message__body"><small className="scene-message__meta">Sena · 10:50 PM</small><div className="scene-message__bubble"><p>Inside. Front left was correct.</p></div><div className="scene-message__reactions" aria-label="3 dancing reactions"><i>💃</i><b>3</b></div></div></article>
        </>}
      </div>
      <div className="room-product-phone__composer">{conversation === "inside" ? <i className="scene-concierge" aria-label="VIP concierge"><ConciergeBell size={13} aria-hidden="true" /><small>VIP</small></i> : <Camera size={17} />}<span>Message The Room</span><Send size={16} /></div>
    </div>
    <span className="room-product-phone__home" aria-hidden="true" />
    </div>
  </article>;
}

export default function ActiveNightExperience({ events }: { events: CuratedEvent[] }) {
  const [observedAt] = useState(() => Date.now());
  const scenes = useMemo(() => events.filter((event) => event.eventState !== "cancelled" && event.eventState !== "postponed" && Date.parse(event.endsAt) > observedAt).slice(0, 4), [events, observedAt]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [manualPause, setManualPause] = useState(false);
  const [interactionPause, setInteractionPause] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [leftHero, setLeftHero] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const active = scenes[activeIndex] ?? null;
  const previous = previousIndex === null ? null : scenes[previousIndex] ?? null;
  const heroImage = active?.image ?? fallbackImage;
  const theme = sceneThemes[active?.vibe ?? "Late night"];
  const hasScenes = scenes.length > 1;
  const autoplayRunning = hasScenes && !manualPause && !interactionPause && !documentHidden && !leftHero && !reducedMotion;
  const sceneStyle = {
    "--acid": theme.acid,
    "--signal": theme.signal,
    "--bone": theme.bone,
    "--scene-dark": theme.dark,
  } as CSSProperties;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    updateMotion();
    motionQuery.addEventListener("change", updateMotion);
    return () => motionQuery.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setDocumentHidden(document.visibilityState !== "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.bottom <= 0) setLeftHero(true);
    }, { threshold: 0.05 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplayRunning) return;
    const timer = window.setTimeout(() => {
      setPreviousIndex(activeIndex);
      setActiveIndex((activeIndex + 1) % scenes.length);
    }, sceneInterval);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoplayRunning, scenes.length]);

  useEffect(() => {
    if (previousIndex === null) return;
    const timer = window.setTimeout(() => setPreviousIndex(null), 900);
    return () => window.clearTimeout(timer);
  }, [activeIndex, previousIndex]);

  useEffect(() => {
    if (!hasScenes || reducedMotion) return;
    const next = scenes[(activeIndex + 1) % scenes.length];
    const preload = new window.Image();
    preload.src = eventImageUrl(next.image, 1600, 78);
  }, [activeIndex, hasScenes, reducedMotion, scenes]);

  function toggleAutoplay() {
    if (reducedMotion) return;
    setManualPause((paused) => !paused);
  }

  function leaveFocus(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteractionPause(false);
  }

  return <div className="active-night-experience" style={sceneStyle} data-active-night={active?.slug ?? "waiting"}>
    <section
      ref={heroRef}
      className="compact-hero active-night-hero"
      role="region"
      aria-roledescription={hasScenes ? "carousel" : undefined}
      aria-label="Featured nights"
      onFocusCapture={() => setInteractionPause(true)}
      onBlurCapture={leaveFocus}
      onMouseEnter={() => setInteractionPause(true)}
      onMouseLeave={(event) => setInteractionPause(event.currentTarget.contains(document.activeElement))}
    >
      {previous ? <Image key={`previous-${previous.slug}`} className="compact-hero__image compact-hero__image--outgoing" src={eventImageUrl(previous.image, 1600, 78)} width={1600} height={900} sizes="100vw" alt="" aria-hidden="true" unoptimized /> : null}
      <Image key={active?.slug ?? "waiting"} className="compact-hero__image compact-hero__image--active" src={eventImageUrl(heroImage, 1600, 78)} width={1600} height={900} sizes="100vw" alt={active ? `Atmosphere for ${active.title}` : "A crowd under warm stage lights at night"} priority={activeIndex === 0} unoptimized />
      <div key={`shade-${active?.slug ?? "waiting"}`} className="compact-hero__shade" />
      <div key={`copy-${active?.slug ?? "waiting"}`} className="compact-hero__copy" aria-live={autoplayRunning ? "off" : "polite"} aria-atomic="true">
        <p className="night-kicker"><span /> Accra / Featured night{active?.isTestEvent ? " / Preview" : ""}</p>
        <h1>{active?.title ?? "Plans, sorted."}</h1>
        <p>{active ? `${active.vibe} · ${active.day} ${active.shortDate} · ${active.time.split(" — ")[0]}` : "Discover music, people and places worth going out for."}</p>
        {active ? <p className="hero-venue">{active.venue}, {active.area}</p> : null}
        {active ? <div><Link href={`/event/${active.slug}`}>Explore the night <ArrowRight size={16} /></Link>{active.ticketTiers.some((tier) => tier.status === "available") ? <Link href={`/checkout/${active.slug}`}>Get tickets <Ticket size={15} /></Link> : <Link href="/events">Browse events <ArrowRight size={15} /></Link>}</div> : <Link href="/events" className="compact-hero__single">Explore The Drop <ArrowRight size={15} /></Link>}
      </div>
      {active ? <p className="compact-hero__price" aria-label={`From GH₵${discoveryPrice(active)}, including booking fee`}>From <b>GH₵{discoveryPrice(active)}</b></p> : null}
      {hasScenes ? <button
        type="button"
        className="active-night-autoplay-toggle"
        aria-label={reducedMotion ? "Motion off: featured nights respect your Reduce Motion setting" : manualPause ? "Motion off: play featured nights slideshow" : "Motion on: pause featured nights slideshow"}
        aria-pressed={manualPause || reducedMotion}
        disabled={reducedMotion}
        onClick={toggleAutoplay}
      ><small aria-hidden="true">{String(activeIndex + 1).padStart(2, "0")} / {String(scenes.length).padStart(2, "0")}</small><span>Motion {manualPause || reducedMotion ? "off" : "on"}</span></button> : null}
    </section>

    <section className="night-drop night-drop--compact" id="drop">
      <div className="compact-section-head"><div><p className="night-kicker"><span /> The Drop / Accra</p><h2>Where are we going?</h2></div><Link href="/events">All events <ArrowRight size={15} /></Link></div>
      <EventExplorer events={events} featuredSlug={active?.slug} />
    </section>

    <section className="room-product-scene active-night-room" id="the-room" data-scroll-reveal>
      <Image className="room-product-scene__atmosphere" src={eventImageUrl(heroImage, 1200, 75)} width={1200} height={800} sizes="100vw" alt="" aria-hidden="true" unoptimized />
      <div className="room-product-scene__copy"><p className="night-kicker"><span /> More than a ticket</p><h2>The night has a Room.</h2><p>Meet the people going. Get updates from the Host. Share Flashes that disappear when the Room closes.</p><span><LockKeyhole size={13} /> Private to verified ticket holders</span><p className="room-preview-disclosure">Illustrative preview · conversations shown are examples.</p></div>
      <RoomPreviewCarousel key={active?.slug ?? "waiting"}>
        <RoomPhone event={active} heroImage={heroImage} conversation="arrival" />
        <RoomPhone event={active} heroImage={heroImage} conversation="inside" />
      </RoomPreviewCarousel>
    </section>
  </div>;
}
